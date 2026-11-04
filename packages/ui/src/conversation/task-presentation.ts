import type { Event, ToolResult } from '@praxis/contracts';
import type { Snapshot } from '../client-types.ts';
import { approvalPresentation } from './approval-presentation.ts';
import { statusText } from './types.ts';
import {
  isToolResult,
  parseToolResult,
  textField,
  toolAction,
  toolOutcome,
} from './tool-presentation.ts';

export const activeTaskStatuses = new Set([
  'running',
  'waiting_input',
  'waiting_approval',
  'cancelling',
]);

export function taskStatus(status: string): string {
  return Object.hasOwn(statusText, status) ? statusText[status]! : '状态未识别';
}

/** Only events at or before this authoritative snapshot belong to its presentation. */
export function taskEvents(snapshot: Snapshot, events: readonly Event[]): Event[] {
  const visible = events
    .filter((event) => event.sessionId === snapshot.session.id && event.seq <= snapshot.throughSeq)
    .sort((a, b) => a.seq - b.seq);
  const latestTurn = visible.findLast(
    (event) => event.type === 'turn/started' || event.type === 'turn/finished',
  );
  const turnId =
    snapshot.turnId ??
    (activeTaskStatuses.has(snapshot.session.status) ? null : latestTurn?.payload.turnId);
  return typeof turnId === 'string'
    ? visible.filter((event) => event.payload.turnId === turnId)
    : [];
}

export interface TaskTiming {
  startedAt: number | null;
  finishedAt: number | null;
  active: boolean;
}

export function taskTiming(snapshot: Snapshot, events: readonly Event[]): TaskTiming {
  const relevant = taskEvents(snapshot, events);
  const start = relevant.find((event) => event.type === 'turn/started');
  const finish = relevant.findLast((event) => event.type === 'turn/finished');
  const startedAt = start ? Date.parse(start.timestamp) : NaN;
  const finishedAt =
    finish && finish.payload.status === snapshot.session.status
      ? Date.parse(finish.timestamp)
      : NaN;
  return {
    startedAt: Number.isFinite(startedAt) ? startedAt : null,
    finishedAt: Number.isFinite(finishedAt) && finishedAt >= startedAt ? finishedAt : null,
    active: activeTaskStatuses.has(snapshot.session.status) && !finish,
  };
}

export function elapsedText(timing: TaskTiming, now: number): string {
  const end = timing.finishedAt ?? (timing.active ? now : null);
  if (timing.startedAt === null || end === null || !Number.isFinite(end) || end < timing.startedAt)
    return '暂无时间记录';
  const seconds = Math.floor((end - timing.startedAt) / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分`;
}

export function currentTaskAction(
  snapshot: Snapshot,
  events: readonly Event[],
  partial = '',
): string {
  const status = snapshot.session.status;
  if (!activeTaskStatuses.has(status))
    return status === 'idle' ? '等待开始任务' : `本轮${taskStatus(status)}`;
  if (status === 'cancelling') return '正在停止本轮任务';
  if (snapshot.approval) {
    const approval = approvalPresentation(snapshot.approval);
    return `等待批准：${approval.action} · ${approval.target}`;
  }
  if (status === 'waiting_approval') return '等待你的批准';
  if (snapshot.question || status === 'waiting_input') return '等待你的回答';
  const relevant = taskEvents(snapshot, events);
  const done = new Set(
    relevant.flatMap((event) =>
      event.type === 'tool/result' && isToolResult(event.payload.result)
        ? [event.payload.result.callId]
        : [],
    ),
  );
  const intent = relevant.findLast(
    (event) => event.type === 'tool/intent' && !done.has(String(event.payload.callId)),
  );
  const name = textField(intent?.payload, 'name');
  if (name) return toolAction(name);
  return partial ? '正在生成回复' : '任务进行中，等待下一条执行记录';
}

export interface TaskFile {
  path: string;
  artifactId: string;
  action: string;
  outcome: string;
}

export function taskResults(snapshot: Snapshot) {
  const recorded = new Map<string, ToolResult>();
  for (const event of snapshot.events ?? []) {
    if (
      event.sessionId === snapshot.session.id &&
      event.seq <= snapshot.throughSeq &&
      event.type === 'tool/result' &&
      isToolResult(event.payload.result)
    )
      recorded.set(event.payload.result.callId, event.payload.result);
  }
  const results: ToolResult[] = [];
  let unreadable = 0;
  for (const message of snapshot.messages) {
    if (message.role !== 'tool') continue;
    const result = parseToolResult(message.content);
    if (result) results.push(recorded.get(result.callId) ?? result);
    else unreadable++;
  }
  const files = new Map<string, TaskFile>();
  for (const result of results) {
    const artifactId = textField(result.data, 'diffArtifactId');
    if (!artifactId) continue;
    files.set(artifactId, {
      artifactId,
      path: textField(result.data, 'path') ?? '文件变更记录',
      action: toolAction(result.toolId, result.data),
      outcome: toolOutcome(result),
    });
  }
  const lastUser = snapshot.messages.findLastIndex((message) => message.role === 'user');
  const summary = snapshot.messages
    .slice(lastUser + 1)
    .findLast((message) => message.role === 'assistant' && message.content.trim());
  return {
    results,
    files: [...files.values()],
    unreadable,
    summary,
    durationMs: results.reduce((total, result) => total + result.durationMs, 0),
  };
}
