import { Copy, MarkdownView } from '../MarkdownView.tsx';

import type { AppController } from '../app/useAppController.ts';
import { ApprovalCard } from '../conversation/ApprovalCard.tsx';
import { QuestionCard } from '../conversation/QuestionCard.tsx';
import { ToolCard } from '../conversation/ToolCard.tsx';

export function MessageList({
  client,
  providerId,
  selected,
  snapshot,
  partial,
  question,
  setQuestion,
  fail,
  running,
  showChange,
}: Pick<
  AppController,
  | 'client'
  | 'providerId'
  | 'selected'
  | 'snapshot'
  | 'partial'
  | 'question'
  | 'setQuestion'
  | 'fail'
  | 'running'
  | 'showChange'
>) {
  return (
    <div className="messages">
      {snapshot?.messages.map((message) =>
        message.role === 'tool' ? (
          <ToolCard
            key={message.id}
            content={message.content}
            showChange={(id) => {
              void showChange(id);
            }}
          />
        ) : (
          <article className={`message ${message.role}`} key={message.id}>
            <div className="message-label">{message.role === 'user' ? '你' : '知行'}</div>
            <div className="message-content">
              {message.role === 'user' ? (
                <p>{message.content}</p>
              ) : (
                <MarkdownView content={message.content} />
              )}
              {message.status && ['failed', 'interrupted'].includes(message.status) && (
                <span className="incomplete">未完整结束</span>
              )}
            </div>
            {message.role === 'assistant' && message.content && (
              <div className="message-actions">
                <Copy text={message.content} iconOnly />
                {client.regenerate &&
                  selected &&
                  !running &&
                  message.id ===
                    snapshot?.messages.filter((m) => m.role === 'assistant').at(-1)?.id && (
                    <button
                      className="text-button"
                      onClick={() => {
                        void client.regenerate!(selected, providerId).catch(fail);
                      }}
                    >
                      重新生成
                    </button>
                  )}
              </div>
            )}
          </article>
        ),
      )}
      {partial && (
        <article className="message assistant">
          <div className="message-label">知行</div>
          <div className="message-content">
            <MarkdownView content={partial} />
            <span className="stream-cursor" />
          </div>
        </article>
      )}
      {snapshot?.approval && client.respondApproval && (
        <ApprovalCard
          key={snapshot.approval.approvalId}
          approval={snapshot.approval}
          submit={async (decision) => {
            const approval = snapshot.approval!;
            await client.respondApproval!({
              sessionId: approval.sessionId,
              turnId: approval.turnId,
              approvalId: approval.approvalId,
              requestHash: approval.requestHash,
              decision,
            });
          }}
        />
      )}
      {question && selected && (
        <QuestionCard
          key={question.questionId}
          question={question}
          submit={async (answers) => {
            try {
              await client.answer?.({
                sessionId: selected,
                questionId: question.questionId,
                turnId: question.turnId,
                answers,
              });
              setQuestion(null);
            } catch (e) {
              fail(e);
            }
          }}
        />
      )}
    </div>
  );
}
