import type { Event } from '@praxis/contracts';
import { useMemo } from 'react';
import { MarkdownView } from '../MarkdownView.tsx';
import type { Snapshot } from '../client-types.ts';
import { approvalPresentation } from './approval-presentation.ts';
import {
  currentTaskAction,
  taskResults,
  taskStatus,
  taskTiming,
  type TaskFile,
} from './task-presentation.ts';
import { toolAction, toolOutcome, toolSummary } from './tool-presentation.ts';
import { useTaskElapsed } from './useTaskElapsed.ts';
import '../styles/task-feedback.css';

export interface TaskOverviewProps {
  snapshot: Snapshot;
  events?: readonly Event[];
  partial?: string;
  showChange: (artifactId: string) => void;
  onInteract?: () => void;
}
const noEvents: readonly Event[] = [];

export function TaskOverview({
  snapshot,
  events = noEvents,
  partial = '',
  showChange,
  onInteract,
}: TaskOverviewProps) {
  const presentation = useMemo(() => taskResults(snapshot), [snapshot]);
  const elapsed = useTaskElapsed(taskTiming(snapshot, events));
  return (
    <section className="task-overview" aria-label="任务概览">
      <header className="task-tool-heading">
        <h2>任务概览</h2>
        <span className="task-status" data-status={snapshot.session.status} role="status">
          {taskStatus(snapshot.session.status)}
        </span>
      </header>
      <dl className="task-facts">
        <div>
          <dt>当前动作</dt>
          <dd>{currentTaskAction(snapshot, events, partial)}</dd>
        </div>
        <div>
          <dt>本轮耗时</dt>
          <dd>
            {elapsed}
            {presentation.results.length > 0 && (
              <span className="task-note">
                {' '}
                · 累计工具调用耗时 {presentation.durationMs} 毫秒（此会话）
              </span>
            )}
          </dd>
        </div>
      </dl>
      <TaskPending snapshot={snapshot} onInteract={onInteract} />
      <PendingInputs snapshot={snapshot} />
      <details className="task-result-details">
        <summary>
          结果与文件 · {presentation.results.length} 条工具结果 · {presentation.files.length}{' '}
          条文件变更
        </summary>
        <TaskResultSummary presentation={presentation} />
        <TaskFiles files={presentation.files} showChange={showChange} />
      </details>
    </section>
  );
}

function TaskPending({
  snapshot,
  onInteract,
}: {
  snapshot: Snapshot;
  onInteract: (() => void) | undefined;
}) {
  const approval = snapshot.approval ? approvalPresentation(snapshot.approval) : null;
  const questions = snapshot.question?.questions ?? [];
  if (!approval && !questions.length)
    return (
      <p className="task-note">
        {['waiting_approval', 'waiting_input'].includes(snapshot.session.status)
          ? '正在等待交互详情，请查看下方记录。'
          : '暂无待处理事项'}
      </p>
    );
  return (
    <div className="task-pending">
      <h3>待你处理</h3>
      {approval && (
        <p>
          1 项审批：{approval.action} · {approval.target}。请在下方审批卡中决定。
        </p>
      )}
      {questions.map((question) => (
        <p key={question.id}>待回答：{question.prompt}</p>
      ))}
      {onInteract && (
        <button type="button" className="task-file-link" onClick={onInteract}>
          前往处理
        </button>
      )}
    </div>
  );
}

function TaskResultSummary({ presentation }: { presentation: ReturnType<typeof taskResults> }) {
  const { results, unreadable, summary } = presentation;
  return (
    <div className="task-results">
      <h3>结果摘要</h3>
      {summary ? (
        <div className="task-summary-text">
          <p className="task-note">最近回复摘录</p>
          <MarkdownView
            content={summary.content.slice(0, 240) + (summary.content.length > 240 ? '…' : '')}
          />
        </div>
      ) : (
        <p>尚无本轮文字总结。</p>
      )}
      {summary?.status && ['failed', 'interrupted'].includes(summary.status) && (
        <p className="task-note">以上回复未完整结束。</p>
      )}
      <p className="task-note">
        此会话累计 {results.length} 条工具结果
        {unreadable > 0 ? `，另有 ${unreadable} 条记录无法解析` : ''}。
      </p>
      {results.length > 0 && (
        <details>
          <summary>查看工具结果摘要</summary>
          <ul>
            {results.map((result, index) => (
              <li key={`${result.callId}-${index}`}>
                <strong>
                  {toolAction(result.toolId, result.data)} · {toolOutcome(result)}
                </strong>
                <p>{toolSummary(result)}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function TaskFiles({ files, showChange }: { files: TaskFile[]; showChange: (id: string) => void }) {
  return (
    <div className="task-files">
      <h3>文件变更 · {files.length} 条历史记录</h3>
      {files.length ? (
        <ul>
          {files.map((file) => (
            <li key={file.artifactId}>
              <button
                type="button"
                className="task-file-link"
                onClick={() => showChange(file.artifactId)}
              >
                {file.path}
              </button>
              <span className="task-note">
                {file.action} · {file.outcome}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p>暂无已记录的文件变更。</p>
      )}
    </div>
  );
}

function PendingInputs({ snapshot }: { snapshot: Snapshot }) {
  const inputs = snapshot.pendingInputs ?? [];
  if (!inputs.length) return null;
  return (
    <details className="task-pending-inputs">
      <summary>待处理输入 · {inputs.length} 条</summary>
      <ul>
        {inputs.map((input) => (
          <li key={input.id}>
            <strong>{input.mode === 'steer' ? '追加指导' : '排队输入'}</strong>
            <p>{input.text}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
