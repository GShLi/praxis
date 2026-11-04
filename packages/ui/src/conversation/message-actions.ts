import type { PraxisClient, Snapshot } from '../client-types.ts';
import type { Question } from './types.ts';

export function messageActions(
  client: PraxisClient,
  selected: string | null,
  snapshot: Snapshot | null,
  question: Question | null,
  setQuestion: (value: Question | null) => void,
  fail: (error: unknown) => void,
) {
  const approve = async (decision: 'approve-once' | 'deny') => {
    const approval = snapshot?.approval;
    if (!approval || !client.respondApproval) return;
    await client.respondApproval({
      sessionId: approval.sessionId,
      turnId: approval.turnId,
      approvalId: approval.approvalId,
      requestHash: approval.requestHash,
      decision,
    });
  };
  const answer = async (answers: unknown) => {
    if (!question || !selected) return;
    try {
      await client.answer?.({
        sessionId: selected,
        questionId: question.questionId,
        turnId: question.turnId,
        answers,
      });
      setQuestion(null);
    } catch (error) {
      fail(error);
    }
  };
  return { approve, answer };
}
