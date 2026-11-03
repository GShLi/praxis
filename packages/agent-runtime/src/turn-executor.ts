import { pluginContext, finishPluginTurn, resolvePluginModel } from '@praxis/plugin-host';
import {
  assert,
  PraxisError,
  safeError,
  type TurnStatus,
  type Session,
  type ModelConfig,
} from '@praxis/contracts';
import { ApprovalGate } from '@praxis/permissions';
import { SessionStore } from '@praxis/storage-local';
import { createTurnTools } from './turn-tools.ts';
import { realpath } from 'node:fs/promises';
import { QuestionGate } from './questions.ts';
import { TurnSteps } from './turn-steps.ts';
import type { Active, RuntimeOptions } from './types.ts';
import { executeUserCommand } from './user-command.ts';
export class TurnExecutor {
  private workspaceOwners = new Map<string, string>();
  constructor(
    private store: SessionStore,
    private options: RuntimeOptions,
    private questions: QuestionGate,
    private approvals: ApprovalGate,
    private emit: (name: string, payload: unknown) => void,
  ) {}
  async run(id: string, turn: Active) {
    const session = this.store.get(id);
    const signal = turn.controller.signal;
    const plugins = this.options.plugins?.(session.kind) ?? [];
    let workspace: string | undefined;
    let claimed = false;
    let steps: TurnSteps | undefined;
    let terminal: TurnStatus = 'completed';
    let workspaceLease:
      | Awaited<ReturnType<NonNullable<RuntimeOptions['acquireWorkspace']>>>
      | undefined;
    const timer = setTimeout(
      () => turn.controller.abort(new PraxisError('TURN_TIMEOUT', '任务时间预算已用完。')),
      Math.max(1, turn.deadline - Date.now()),
    );
    try {
      if (turn.command) await this.options.authorizeCommand?.(session.ownerUserId, signal);
      const config = turn.command
        ? undefined
        : await this.options.beginUse(session.ownerUserId, signal);
      signal.throwIfAborted();
      if (config) {
        const provider = resolvePluginModel(plugins, config, this.options.model);
        turn.providerDescriptor = provider.descriptor;
        steps = new TurnSteps(this.store, { ...this.options, model: provider.model }, this.emit);
      }
      if (session.kind === 'agent') {
        workspace = await realpath(session.workspace!);
        assert(!this.workspaceOwners.has(workspace), 'WORKSPACE_BUSY', '此工作区已有活动执行。');
        this.workspaceOwners.set(workspace, id);
        workspaceLease = await this.options.acquireWorkspace?.(workspace, signal);
        workspaceLease?.onLost(() => turn.controller.abort());
        turn.executor = await createTurnTools(
          this.store,
          this.options,
          session,
          turn,
          workspace,
          plugins,
          this.questions,
          this.approvals,
          config,
        );
      }
      signal.throwIfAborted();
      if (!turn.command) turn.pluginContext = await pluginContext(plugins, session, signal);
      const inputs = this.claim(session, turn, config);
      if (!inputs.length) return;
      claimed = true;
      const command = inputs[0]?.command;
      if (command) await executeUserCommand(this.store, turn, command, plugins);
      else {
        assert(steps && config, 'TURN_INPUT_CONFLICT', '任务输入与执行方式不匹配。');
        await steps.run(session, turn, config);
      }
    } catch (error) {
      terminal = signal.aborted ? 'cancelled' : 'failed';
      if (steps?.partial)
        this.store.append(
          id,
          'assistant/partial',
          { turnId: turn.id, attemptId: steps.attemptId, content: steps.partial, incomplete: true },
          'model',
        );
      this.store.append(id, 'turn/error', { turnId: turn.id, ...safeError(error) });
      // Do not spin indefinitely on failed begin-use/configuration or poisoned pending tasks.
      this.store.suspend(id);
    } finally {
      turn.finishing = true;
      clearTimeout(timer);
      try {
        await turn.executor?.close();
      } catch {
        terminal = 'interrupted';
        this.store.append(id, 'execution/cleanup_unknown', { turnId: turn.id });
      }
      if (workspace && this.workspaceOwners.get(workspace) === id)
        this.workspaceOwners.delete(workspace);
      await workspaceLease?.release();
      this.store.transaction(() => {
        this.store.update(id, { status: terminal });
        this.store.append(id, 'turn/finished', {
          turnId: turn.id,
          status: terminal,
          claimed,
          steps: turn.steps,
          attempts: turn.attempts,
          tools: turn.tools,
        });
        this.store.checkpoint(id);
      });
      if (claimed)
        await finishPluginTurn(plugins, id, terminal, (details) => {
          this.store.transaction(() => {
            this.store.append(id, 'plugin/hook-error', { turnId: turn.id, ...details });
            this.store.checkpoint(id);
          });
        });
    }
  }
  private claim(session: Session, turn: Active, config?: ModelConfig) {
    const id = session.id;
    return this.store.transaction(() => {
      const inputs = this.store.claim(id, turn.id, true);
      if (!inputs.length) return [];
      this.store.update(id, {
        status: 'running',
        title: session.title === '新会话' ? inputs[0]!.text.slice(0, 60) : session.title,
      });
      this.store.append(id, 'turn/started', {
        turnId: turn.id,
        inputIds: inputs.map((i) => i.id),
        providerId: config?.id ?? null,
        configRevision: config?.revision ?? null,
        kind: turn.command ? 'plugin-command' : 'model',
      });
      return inputs;
    });
  }
}
