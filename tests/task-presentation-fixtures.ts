import type { Event, ToolResult } from '@praxis/contracts';
import type { ApprovalRequest } from '@praxis/permissions';
import type { Snapshot } from '@praxis/ui/client';

export function result(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    callId: 'call',
    toolId: 'fs.write',
    toolVersion: 1,
    status: 'succeeded',
    effectState: 'committed',
    data: { path: 'src/example.ts', diffArtifactId: 'artifact' },
    artifactIds: ['artifact'],
    truncated: false,
    durationMs: 42,
    ...overrides,
  };
}
export function snapshot(status = 'completed'): Snapshot {
  return {
    session: {
      id: 'session',
      kind: 'agent',
      title: 'Task',
      status,
      createdAt: '2020-01-01T00:00:00Z',
    },
    messages: [
      { id: 'user', role: 'user', content: '修改文件' },
      { id: 'tool', role: 'tool', content: JSON.stringify(result()) },
    ],
    turnId: status === 'running' ? 'turn' : null,
    throughSeq: 100,
  };
}
export function event(
  type: string,
  seq: number,
  timestamp: string,
  payload: Record<string, unknown> = {},
): Event {
  return {
    eventId: `event-${seq}`,
    sessionId: 'session',
    seq,
    schemaVersion: 1,
    type,
    source: 'host',
    timestamp,
    payload: { turnId: 'turn', ...payload },
  };
}
export function approval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    callId: 'call',
    toolId: 'fs.write',
    parameters: { path: '中文/hello.ts', mode: 'replace', content: '<exact>\n你好' },
    reason: '此操作需要批准',
    resources: { workspace: '/project' },
    approvalId: 'approval',
    sessionId: 'session',
    turnId: 'turn',
    permissionRevision: 1,
    argumentsHash: 'hash',
    expiresAt: 10000,
    requestHash: 'request',
    ...overrides,
  };
}
