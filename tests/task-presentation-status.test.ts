import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  ToolPresentation,
  ApprovalPresentation,
  TaskPresentation,
} from './task-presentation-contracts.ts';
const {
  toolAction,
  toolOutcome,
  toolStatusText,
  toolSummary,
  toolVisualStatus,
  parseToolResult,
}: ToolPresentation = await import(
  new URL('../packages/ui/src/conversation/tool-presentation.ts', import.meta.url).href
);
const { approvalPresentation }: ApprovalPresentation = await import(
  new URL('../packages/ui/src/conversation/approval-presentation.ts', import.meta.url).href
);
const { taskStatus, currentTaskAction, taskTiming, elapsedText, taskResults }: TaskPresentation =
  await import(
    new URL('../packages/ui/src/conversation/task-presentation.ts', import.meta.url).href
  );
import { result, snapshot, event, approval } from './task-presentation-fixtures.ts';

test('all persisted tool and task states have human Chinese labels and unknown states stay unknown', () => {
  for (const [state, label] of Object.entries(toolStatusText)) {
    assert.match(label, /[\u4e00-\u9fff]/);
    assert.notEqual(label, state);
  }
  for (const state of [
    'idle',
    'running',
    'waiting_input',
    'waiting_approval',
    'cancelling',
    'completed',
    'failed',
    'cancelled',
    'interrupted',
  ])
    assert.notEqual(taskStatus(state), '状态未识别');
  assert.equal(taskStatus('future-state'), '状态未识别');
  assert.equal(taskStatus('completed'), '已完成');
  assert.equal(taskStatus('failed'), '执行失败');
  assert.equal(taskStatus('cancelled'), '已停止');
});

test('human action labels cover core tools without fabricating extension behavior', () => {
  assert.equal(toolAction('fs.read'), '读取文件');
  assert.equal(toolAction('fs_apply_patch'), '修改文件');
  assert.equal(toolAction('fs.write', { operation: 'created' }), '创建文件');
  assert.equal(toolAction('process.exec'), '运行命令');
  assert.equal(toolAction('mcp__remote'), '调用远程工具');
  assert.equal(toolAction('plugin:custom'), '调用扩展工具');
});

test('successful status read does not claim successful command execution or verification', () => {
  const reading = result({
    toolId: 'process.read',
    data: { processState: 'failed', exitCode: 1 },
    effectState: 'none',
  });
  assert.equal(toolOutcome(reading), '命令执行失败');
  assert.equal(toolVisualStatus(reading), 'failed');
  assert.equal(toolSummary(reading), '命令退出码：1');
  assert.equal(toolOutcome({ ...reading, data: { processState: 'unknown' } }), '命令结果未确认');
  assert.equal(
    toolOutcome({ ...reading, status: 'denied', data: { processState: 'running' } }),
    '未获批准 · 命令执行中',
  );
});

test('malformed or legacy tool JSON falls back without inventing a successful result', () => {
  for (const value of [
    'null',
    '[]',
    '{}',
    '{broken',
    JSON.stringify({ status: 'succeeded' }),
    JSON.stringify(result({ durationMs: -1 })),
  ])
    assert.equal(parseToolResult(value), null);
  assert.deepEqual(parseToolResult(JSON.stringify(result())), result());
});

test('approval effect and target precede exact unchanged parameters for local and remote operations', () => {
  const request = approval();
  const original = JSON.stringify(request);
  const view = approvalPresentation(request);
  assert.equal(view.target, '中文/hello.ts');
  assert.match(view.effect, /更改现有内容/);
  assert.equal(JSON.stringify(request), original);
  const remote = approvalPresentation(
    approval({
      toolId: 'mcp__send',
      parameters: { value: 'abc' },
      resources: { server: '服务', endpoint: 'https://example.com/mcp' },
    }),
  );
  assert.equal(remote.target, 'https://example.com/mcp');
  assert.match(remote.effect, /发送到远程服务/);
});

test('terminal statuses remain visible and never repeat a previous tool as currently running', () => {
  const events = [
    event('tool/intent', 1, '2026-01-01T00:00:00Z', { name: 'fs_write', callId: 'call' }),
  ];
  for (const state of ['completed', 'failed', 'cancelled', 'interrupted'])
    assert.equal(
      currentTaskAction(snapshot(state), events, 'stale partial'),
      `本轮${taskStatus(state)}`,
    );
  assert.equal(currentTaskAction(snapshot('running'), events), '写入文件');
  assert.match(
    currentTaskAction(snapshot('running'), [
      ...events,
      event('tool/result', 2, '2026-01-01T00:00:01Z', { result: result() }),
    ]),
    /等待下一条执行记录/,
  );
});

test('pending approvals and questions take precedence over tool and streaming actions', () => {
  assert.match(
    currentTaskAction({ ...snapshot('running'), approval: approval() }, [], 'stream'),
    /等待批准：写入文件/,
  );
  assert.equal(
    currentTaskAction(
      { ...snapshot('running'), question: { questionId: 'q', turnId: 'turn', questions: [] } },
      [],
    ),
    '等待你的回答',
  );
  assert.equal(currentTaskAction(snapshot('cancelling'), []), '正在停止本轮任务');
});

test('elapsed time requires authoritative turn timestamps, never session age or mount time', () => {
  const start = event('turn/started', 1, '2026-01-01T00:00:00Z');
  const finish = event('turn/finished', 2, '2026-01-01T00:01:05Z', { status: 'completed' });
  const now = Date.parse('2026-01-02T00:00:00Z');
  assert.equal(elapsedText(taskTiming(snapshot(), [start, finish]), now), '1 分 5 秒');
  assert.equal(elapsedText(taskTiming(snapshot(), [start]), now), '暂无时间记录');
  assert.equal(elapsedText(taskTiming(snapshot(), [finish]), now), '暂无时间记录');
  assert.equal(elapsedText(taskTiming(snapshot('running'), []), now), '暂无时间记录');
  assert.equal(
    elapsedText(taskTiming(snapshot('running'), [start]), Date.parse(start.timestamp) + 5000),
    '5 秒',
  );
  assert.equal(taskResults(snapshot()).durationMs, 42);
});

test('event timing ignores other sessions, turns, future events and invalid clocks', () => {
  const start = event('turn/started', 1, '2026-01-01T00:00:00Z');
  const finish = event('turn/finished', 2, '2026-01-01T00:00:05Z', { status: 'completed' });
  const cases = [
    [{ ...start, sessionId: 'other' }, finish],
    [{ ...start, payload: { turnId: 'other' } }, finish],
    [start, { ...finish, seq: 101 }],
    [{ ...start, timestamp: 'invalid' }, finish],
    [start, { ...finish, timestamp: '2025-01-01T00:00:00Z' }],
  ];
  for (const events of cases)
    assert.equal(elapsedText(taskTiming(snapshot(), events), Date.now()), '暂无时间记录');
});

test('file records link to original artifact IDs, retain revisions and do not reuse old reply summaries', () => {
  const state = snapshot();
  state.messages.push({
    id: 'second',
    role: 'tool',
    content: JSON.stringify(
      result({
        callId: 'second',
        data: { path: 'src/example.ts', diffArtifactId: 'second-artifact' },
      }),
    ),
  });
  const view = taskResults(state);
  assert.deepEqual(
    view.files.map((file) => file.artifactId),
    ['artifact', 'second-artifact'],
  );
  assert.equal(view.durationMs, 84);
  state.messages.push(
    { id: 'reply', role: 'assistant', content: '之前的总结' },
    { id: 'new', role: 'user', content: '下一轮' },
  );
  assert.equal(taskResults(state).summary, undefined);
});

test('authoritative result events recover file links from truncated message projections', () => {
  const state = snapshot();
  state.messages[1]!.content = JSON.stringify(
    result({ data: { preview: 'truncated' }, truncated: true }),
  );
  state.events = [event('tool/result', 2, '2026-01-01T00:00:05Z', { result: result() })];
  assert.equal(taskResults(state).files[0]?.artifactId, 'artifact');
  state.events[0]!.sessionId = 'other';
  assert.equal(taskResults(state).files.length, 0);
});
