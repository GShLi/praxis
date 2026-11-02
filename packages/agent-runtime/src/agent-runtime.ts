import { assert, promptSchema } from '@praxis/contracts';
import { ApprovalGate } from '@praxis/permissions';
import { SessionStore, uuid } from '@praxis/storage-local';
import { EventEmitter } from 'node:events';
import { QuestionGate } from './questions.ts';
import { TurnExecutor } from './turn-executor.ts';
import type { Active, RuntimeOptions } from './types.ts';

/** One coordinator per Host. Control methods never wait for model/tool/user completion. */
export class AgentRuntime extends EventEmitter {
  readonly approvals: ApprovalGate;
  private questions: QuestionGate;
  private turns: TurnExecutor;
  private active = new Map<string, Active>();

  private closing = false;
  constructor(
    readonly store: SessionStore,
    readonly options: RuntimeOptions,
  ) {
    super();
    this.questions = new QuestionGate(store, options.interactive ?? false, (id) =>
      this.getTurn(id),
    );
    this.approvals = new ApprovalGate(store, options.interactive ?? false, (id) =>
      this.getTurn(id),
    );
    this.turns = new TurnExecutor(
      store,
      options,
      this.questions,
      this.approvals,
      (name, payload) => {
        this.emit(name, payload);
      },
    );
  }
  get busy() {
    return this.active.size > 0;
  }
  pendingQuestion(...args: Parameters<QuestionGate['pendingQuestion']>) {
    return this.questions.pendingQuestion(...args);
  }
  getTurn(id: string) {
    const turn = this.active.get(id);
    return turn?.finishing ? undefined : turn?.id;
  }
  prompt(owner: string, raw: unknown) {
    const input = promptSchema.parse(raw);
    const session = this.store.get(input.sessionId, owner);
    assert(!this.closing, 'HOST_CLOSING', 'Host 正在退出。');
    const accepted = this.store.accept(input, this.getTurn(session.id));
    this.schedule(session.id);
    return accepted;
  }
  private schedule(id: string) {
    if (
      this.closing ||
      this.active.has(id) ||
      this.active.size >= 4 ||
      !this.store.inputs(id, 'pending').length
    )
      return;
    const controller = new AbortController();
    const turn: Active = {
      id: uuid(),
      controller,
      done: Promise.resolve(),
      steps: 0,
      attempts: 0,
      tools: 0,
      deadline:
        Date.now() +
        Math.min(
          this.options.timeoutMs ?? 3_600_000,
          this.store.get(id).kind === 'chat' ? 600_000 : 3_600_000,
        ),
    };
    this.active.set(id, turn);
    turn.done = Promise.resolve()
      .then(() => this.turns.run(id, turn))
      .finally(() => {
        this.active.delete(id);
        if (!this.closing) {
          // Start only pending inputs accepted in this process; restart recovery suspends them.
          for (const session of this.store.list(this.store.get(id).ownerUserId, 500))
            this.schedule(session.id);
        }
      });
    // Consumers observe terminal events; avoid unhandled rejection if storage fails during shutdown.
    void turn.done.catch(() => this.emit('fatal', { code: 'STORAGE_FAILURE', sessionId: id }));
  }

  answer(...args: Parameters<QuestionGate['answer']>) {
    return this.questions.answer(...args);
  }
  cancel(owner: string, id: string, expectedTurnId?: string, cancelPending = false) {
    this.store.get(id, owner);
    const turn = this.active.get(id);
    assert(!expectedTurnId || expectedTurnId === turn?.id, 'TURN_CONFLICT', '要取消的执行已结束。');
    this.store.transaction(() => {
      this.store.suspend(id, cancelPending);
      this.store.append(id, 'turn/cancel_requested', { turnId: turn?.id ?? null }, 'user');
      if (turn) this.store.update(id, { status: 'cancelling' });
    });
    turn?.controller.abort();
    return { accepted: true };
  }
  async wait(id: string) {
    for (;;) {
      const turn = this.active.get(id);
      if (!turn) return;
      await turn.done;
    }
  }

  async close() {
    this.closing = true;
    for (const [id, turn] of this.active) {
      this.store.suspend(id);
      turn.controller.abort();
    }
    await Promise.allSettled([...this.active.values()].map((t) => t.done));
  }
}
