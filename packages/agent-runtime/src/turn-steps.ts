import { ContextBuilder } from '@praxis/context';
import type { Message, ModelConfig, Session, ToolDefinition } from '@praxis/contracts';
import { assert } from '@praxis/contracts';
import { SessionStore, uuid } from '@praxis/storage-local';
import { fixedPrompt } from './prompt.ts';
import { executeToolBatch } from './tool-batch.ts';
import type { Active, RuntimeOptions } from './types.ts';
import { validateResponse } from './validate-response.ts';
export class TurnSteps {
  partial = '';
  attemptId = '';
  constructor(
    private store: SessionStore,
    private options: RuntimeOptions,
    private emit: (name: string, payload: unknown) => void,
  ) {}
  private consumeAttempt(turn: Active) {
    assert(
      ++turn.attempts <= (this.options.maxAttempts ?? 150),
      'BUDGET_EXHAUSTED',
      '模型尝试预算已用完。',
    );
    turn.controller.signal.throwIfAborted();
  }
  async run(session: Session, turn: Active, config: ModelConfig) {
    const id = session.id,
      signal = turn.controller.signal;
    const context = new ContextBuilder(this.store, this.options.model);
    for (;;) {
      signal.throwIfAborted();
      assert(
        ++turn.steps <= (this.options.maxSteps ?? 100),
        'BUDGET_EXHAUSTED',
        '模型步骤预算已用完。',
      );
      this.store.claim(id, turn.id, false);
      const fixed = await fixedPrompt(session, turn, this.store, this.options);
      turn.executor?.boundary();
      const tools = turn.executor?.definitions ?? [];
      const messages = await context.build(id, fixed, tools, config, signal, () =>
        this.consumeAttempt(turn),
      );
      this.consumeAttempt(turn);
      this.attemptId = uuid();
      this.partial = '';
      const stepId = uuid();
      this.snapshot(session, turn, config, stepId, messages, tools);
      this.store.append(id, 'step/started', { turnId: turn.id, stepId, ordinal: turn.steps });
      const response = await this.options.model.complete({
        messages,
        tools,
        config,
        signal,
        purpose: session.kind === 'chat' ? 'chat_generation' : 'agent_step',
        onDelta: (text) => {
          this.partial += text;
          this.emit('delta', { sessionId: id, turnId: turn.id, attemptId: this.attemptId, text });
        },
      });
      signal.throwIfAborted();
      const message = { ...response.message, id: uuid() };
      validateResponse(message, session.kind);
      this.store.message(id, message);
      this.partial = '';
      await executeToolBatch(this.store, id, turn, stepId, message, this.options.maxTools ?? 200);
      this.store.append(id, 'step/finished', { turnId: turn.id, stepId, usage: response.usage });
      signal.throwIfAborted();
      assert(turn.tools <= (this.options.maxTools ?? 200), 'BUDGET_EXHAUSTED', '工具预算已用完。');
      if (!message.toolCalls?.length && (await this.done(id, turn))) break;
    }
  }
  private snapshot(
    session: Session,
    turn: Active,
    config: ModelConfig,
    stepId: string,
    messages: Message[],
    tools: ToolDefinition[],
  ) {
    this.store.append(session.id, 'request/snapshot', {
      turnId: turn.id,
      stepId,
      attemptId: this.attemptId,
      messages,
      tools,
      providerId: config.id,
      configRevision: config.revision,
      model: config.model,
      ...turn.providerDescriptor,
      contextVersion: this.store.context(session.id).version,
      instructionRevision: turn.instructions?.revision ?? 0,
      userInstructions: turn.userInstructions
        ? { revision: turn.userInstructions.revision, hash: turn.userInstructions.hash }
        : null,
    });
  }
  private async done(id: string, turn: Active) {
    // Close steer acceptance synchronously with the final claim, before the caller's await resumes.
    if (this.store.claim(id, turn.id, false).length) return false;
    if (turn.executor?.processes?.active) await turn.executor.processes.close();
    if (this.store.claim(id, turn.id, false).length) return false;
    turn.finishing = true;
    return true;
  }
}
