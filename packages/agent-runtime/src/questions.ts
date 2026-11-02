import { assert, PraxisError } from '@praxis/contracts';
import { SessionStore, uuid } from '@praxis/storage-local';
import type { Ask } from '@praxis/tools';
import { answersSchema } from './question-schema.ts';
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
    return (questions, signal) => {
      assert(this.interactive, 'INPUT_UNAVAILABLE', '当前客户端没有用户回答通道。');
      return new Promise((resolve, reject) => {
        const questionId = uuid();
        const cleanup = () => {
          this.questions.delete(questionId);
          signal.removeEventListener('abort', abort);
        };
        const abort = () => {
          cleanup();
          reject(new PraxisError('CANCELLED', '等待回答已取消。'));
        };
        signal.addEventListener('abort', abort, { once: true });
        this.questions.set(questionId, {
          sessionId: id,
          turnId: turn.id,
          questions,
          resolve: (value) => {
            cleanup();
            resolve(value);
          },
          reject: (error) => {
            cleanup();
            reject(error);
          },
        });
        this.store.transaction(() => {
          this.store.update(id, { status: 'waiting_input' });
          this.store.append(id, 'question/asked', { questionId, turnId: turn.id, questions });
        });
        if (signal.aborted) abort();
      });
    };
  }
  answer(
    owner: string,
    input: { sessionId: string; questionId: string; turnId: string; answers: unknown },
  ) {
    this.store.get(input.sessionId, owner);
    const pending = this.questions.get(input.questionId);
    assert(
      pending &&
        pending.sessionId === input.sessionId &&
        pending.turnId === input.turnId &&
        this.getTurn(input.sessionId) === input.turnId,
      'QUESTION_EXPIRED',
      '问题已失效。',
    );
    const answers = answersSchema.parse(input.answers);
    assert(
      answers.length === pending.questions.length &&
        new Set(answers.map((a) => a.id)).size === answers.length,
      'INVALID_ARGUMENT',
      '请为每个问题提供一个回答或跳过。',
    );
    for (const answer of answers) {
      const question = pending.questions.find((q) => q.id === answer.id);
      assert(question, 'INVALID_ARGUMENT', '问题 ID 无效。');
      if (answer.selectedOptionId)
        assert(
          question.options?.some((o) => o.id === answer.selectedOptionId),
          'INVALID_ARGUMENT',
          '选项 ID 无效。',
        );
      assert(
        answer.skipped || answer.selectedOptionId || answer.text?.trim(),
        'INVALID_ARGUMENT',
        '请选择、填写或明确跳过。',
      );
    }
    const result = { questionId: input.questionId, answers };
    this.store.transaction(() => {
      this.store.append(input.sessionId, 'question/answered', result, 'user');
      this.store.update(input.sessionId, { status: 'running' });
    });
    pending.resolve(result);
    return { accepted: true };
  }
}
