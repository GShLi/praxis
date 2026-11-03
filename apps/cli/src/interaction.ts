import {
  assert,
  pendingQuestionSchema,
  type Event,
  type PendingQuestion,
  type QuestionAnswer,
} from '@praxis/contracts';
import { approvalRequestSchema, type ApprovalRequest } from '@praxis/permissions';
import type { startHost } from '@praxis/client-host';

export class CliInteraction {
  private approval: ApprovalRequest | undefined;
  private question: (PendingQuestion & { answers: QuestionAnswer[] }) | undefined;
  constructor(
    private host: Awaited<ReturnType<typeof startHost>>,
    private sessionId: string,
    private prompt: () => void,
    private json: boolean,
  ) {}
  reset() {
    this.approval = undefined;
    this.question = undefined;
  }
  event(event: Event) {
    if (event.type === 'question/asked') {
      this.question = { ...pendingQuestionSchema.parse(event.payload), answers: [] };
      this.printQuestion();
    }
    if (
      ['question/answered', 'question/closed'].includes(event.type) &&
      event.payload.questionId === this.question?.questionId
    )
      this.question = undefined;
    if (event.type === 'approval/requested') {
      this.approval = approvalRequestSchema.parse(event.payload);
      const approval = this.approval;
      if (!this.json)
        console.log(
          `\n执行审批：${approval.toolId}\n${approval.reason}\n${JSON.stringify(approval.resources ?? {}, null, 2)}\n参数：\n${JSON.stringify(approval.parameters, null, 2)}\n批准此次：/approve ${approval.approvalId}\n拒绝：/deny ${approval.approvalId}`,
        );
      this.prompt();
    }
    if (
      ['approval/resolved', 'approval/closed'].includes(event.type) &&
      event.payload.approvalId === this.approval?.approvalId
    )
      this.approval = undefined;
  }
  async respond(line: string): Promise<boolean> {
    if (line.startsWith('/approve ') || line.startsWith('/deny ')) {
      const approval = this.approval;
      assert(
        approval && line.split(/\s+/)[1] === approval.approvalId,
        'APPROVAL_EXPIRED',
        '请使用当前审批的完整 ID。',
      );
      await this.host.rpc.request('approval/respond', {
        sessionId: this.sessionId,
        turnId: approval.turnId,
        approvalId: approval.approvalId,
        requestHash: approval.requestHash,
        decision: line.startsWith('/approve ') ? 'approve-once' : 'deny',
      });
      if (this.approval === approval) this.approval = undefined;
      this.prompt();
      return true;
    }
    if (!this.question) return false;
    const pending = this.question;
    const item = pending.questions[pending.answers.length];
    assert(item, 'QUESTION_EXPIRED', '当前问题已回答。');
    const choice = /^\d+$/.test(line) ? item.options?.[Number(line) - 1] : undefined;
    const answer = {
      id: item.id,
      ...(choice ? { selectedOptionId: choice.id } : line === '/skip' ? {} : { text: line }),
      skipped: line === '/skip',
    };
    const answers = [...pending.answers, answer];
    if (answers.length === pending.questions.length) {
      try {
        await this.host.rpc.request('question/respond', {
          sessionId: this.sessionId,
          questionId: pending.questionId,
          turnId: pending.turnId,
          answers,
        });
      } catch (error) {
        pending.answers = [];
        this.printQuestion();
        throw error;
      }
      if (this.question === pending) this.question = undefined;
      this.prompt();
    } else {
      pending.answers = answers;
      this.printQuestion();
    }
    return true;
  }
  private printQuestion() {
    const item = this.question?.questions[this.question.answers.length];
    if (!item || this.json) return;
    console.log(`\n${item.prompt}`);
    item.options?.forEach((option, index) => console.log(`  ${index + 1}. ${option.label}`));
    console.log('输入选项序号或文字；/skip 跳过。');
    this.prompt();
  }
}
