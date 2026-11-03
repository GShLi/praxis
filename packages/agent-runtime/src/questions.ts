import { assert, PraxisError } from '@praxis/contracts';
import { SessionStore, uuid } from '@praxis/storage-local';
import type { Ask } from '@praxis/tools';
import { answersSchema, validateAnswers } from './question-schema.ts';
import { fingerprint } from '@praxis/config';
import type { Active, PendingQuestion } from './types.ts';
export class QuestionGate {
  private questions = new Map<string, PendingQuestion>();
  constructor(
    private store: SessionStore,
    private interactive: boolean,
    private getTurn: (id: string) => string | undefined,
  ) {}
  pendingQuestion(sessionId: string) {
    for (const [questionId, q] of this.questions)
      if (q.sessionId === sessionId)
        return { questionId, turnId: q.turnId, questions: q.questions };
    return null;
  }
  ask(id: string, turn: Active): Ask {
    return this.forScope(id, turn.id, () => this.getTurn(id) === turn.id, false);
  }
  forOperation(id: string, operationId: string, lifetime: AbortSignal): Ask {
    const ask = this.forScope(id, operationId, () => !lifetime.aborted, true);
    return (questions, signal, validate) =>
      ask(questions, AbortSignal.any([lifetime, signal]), validate);
  }
  private forScope(id: string, turnId: string, current: () => boolean, detached: boolean): Ask {
    return async (questions, signal, validate) => {
      signal.throwIfAborted();
      assert(this.interactive, 'INPUT_UNAVAILABLE', '当前客户端没有用户回答通道。');
      assert(
        current() && !this.pendingQuestion(id),
        'QUESTION_CONFLICT',
        '操作已结束或正在等待另一项回答。',
      );
      return new Promise((resolve, reject) => {
        const questionId = uuid();
        let settled = false;
        const cleanup = () => {
          settled = true;
          this.questions.delete(questionId);
          signal.removeEventListener('abort', abort);
        };
        const abort = () => {
          if (settled) return;
          cleanup();
          try {
            this.store.transaction(() => {
              this.store.append(id, 'question/closed', { questionId, turnId, code: 'CANCELLED' });
              if (!detached && this.store.get(id).status === 'waiting_input')
                this.store.update(id, { status: 'running' });
            });
            reject(new PraxisError('CANCELLED', '等待回答已取消。'));
          } catch (error) {
            reject(error);
          }
        };
        signal.addEventListener('abort', abort, { once: true });
        this.questions.set(questionId, {
          sessionId: id,
          turnId,
          questions,
          current,
          detached,
          ...(validate ? { validate } : {}),
          resolve: (value) => {
            cleanup();
            resolve(value);
          },
          reject: (error) => {
            cleanup();
            reject(error);
          },
        });
        try {
          this.store.transaction(() => {
            if (!detached) this.store.update(id, { status: 'waiting_input' });
            this.store.append(id, 'question/asked', { questionId, turnId, questions });
          });
        } catch (error) {
          cleanup();
          reject(error);
        }
        if (signal.aborted) abort();
      });
    };
  }
  answer(
    owner: string,
    input: { sessionId: string; questionId: string; turnId: string; answers: unknown },
  ) {
    this.store.get(input.sessionId, owner);
    const answers = answersSchema.parse(input.answers);
    const receipt = this.store.interactionReceipt(
      input.sessionId,
      'question/answered',
      input.questionId,
    );
    if (receipt) {
      assert(
        receipt.turnId === input.turnId && fingerprint(receipt.answers) === fingerprint(answers),
        'ANSWER_CONFLICT',
        '此问题已提交不同的答案。',
      );
      return { accepted: true };
    }
    const pending = this.questions.get(input.questionId);
    assert(
      pending &&
        pending.sessionId === input.sessionId &&
        pending.turnId === input.turnId &&
        pending.current(),
      'QUESTION_EXPIRED',
      '问题已失效。',
    );
    validateAnswers(pending.questions, answers);
    const result = { questionId: input.questionId, turnId: input.turnId, answers };
    pending.validate?.(result);
    this.store.transaction(() => {
      this.store.append(input.sessionId, 'question/answered', result, 'user');
      if (!pending.detached) this.store.update(input.sessionId, { status: 'running' });
    });
    pending.resolve(result);
    return { accepted: true };
  }
}
