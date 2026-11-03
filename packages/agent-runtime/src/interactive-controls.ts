import { assert, PraxisError } from '@praxis/contracts';
import type { ApprovalGate } from '@praxis/permissions';
import { SessionStore, uuid } from '@praxis/storage-local';
import type { QuestionGate } from './questions.ts';

/** Explicit user operations have their own lifetime; they never become model turns. */
export class InteractiveControls {
  private pending = new Map<AbortController, string>();
  constructor(
    private store: SessionStore,
    private questions: QuestionGate,
    private approvals: ApprovalGate,
    private interactive: boolean,
  ) {}
  create(owner: string, sessionId: string) {
    const session = this.store.get(sessionId, owner);
    assert(session.kind === 'agent', 'MODE_UNAVAILABLE', 'ChatBot 不提供外部交互。');
    assert(this.pending.size < 8, 'INPUT_BUSY', '人工交互操作已达到上限。');
    const controller = new AbortController(),
      id = uuid();
    this.pending.set(controller, sessionId);
    const close = () => {
      controller.abort(new PraxisError('CANCELLED', '人工交互已取消。'));
      this.pending.delete(controller);
    };
    return {
      signal: controller.signal,
      ...(this.interactive
        ? { ask: this.questions.forOperation(sessionId, id, controller.signal) }
        : {}),
      approve: this.approvals.forOperation(sessionId, id, controller.signal),
      close,
    };
  }
  cancel(sessionId?: string) {
    for (const [controller, id] of this.pending) {
      if (sessionId && sessionId !== id) continue;
      controller.abort(new PraxisError('CANCELLED', '人工交互已取消。'));
      this.pending.delete(controller);
    }
  }
}
