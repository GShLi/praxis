import type { ToolResult } from '@praxis/contracts';
import { assert } from '@praxis/contracts';
import { SessionStore } from '@praxis/storage-local';
import { readPlan } from './plan.ts';
import { schemas } from './schemas.ts';
import type { Ask } from './types.ts';
export async function executeSessionTool(
  store: SessionStore,
  sessionId: string,
  ask: Ask,
  name: keyof typeof schemas,
  raw: unknown,
  signal: AbortSignal,
  result: ToolResult,
) {
  switch (name) {
    case 'task_update_plan': {
      const input = schemas.task_update_plan.parse(raw);
      const plan = readPlan(store, sessionId);
      assert(input.expectedRevision === plan.revision, 'PLAN_VERSION_CONFLICT', '计划版本已变化。');
      assert(
        new Set(input.items.map((i) => i.id)).size === input.items.length &&
          input.items.filter((i) => i.status === 'in_progress').length <= 1,
        'INVALID_ARGUMENT',
        '计划 ID 必须唯一，最多一项进行中。',
      );
      result.data = { revision: plan.revision + 1, items: input.items };
      store.append(sessionId, 'plan/updated', result.data as Record<string, unknown>, 'tool');
      result.effectState = 'committed';
      break;
    }
    case 'user_ask': {
      const input = schemas.user_ask.parse(raw);
      assert(
        new Set(input.questions.map((q) => q.id)).size === input.questions.length,
        'INVALID_ARGUMENT',
        '题目 ID 必须唯一。',
      );
      result.data = await ask(input.questions, signal);
      break;
    }
    case 'artifact_read': {
      const input = schemas.artifact_read.parse(raw);
      const artifact = store.readArtifact(sessionId, input.artifactId);
      const bytes = Buffer.from(artifact.content);
      const offset = input.cursor ? Number(input.cursor) : 0;
      assert(
        Number.isSafeInteger(offset) &&
          offset >= 0 &&
          offset <= bytes.length &&
          (offset === bytes.length || (bytes[offset]! & 0xc0) !== 0x80),
        'CURSOR_EXPIRED',
        '产物游标无效。',
      );
      let end = Math.min(bytes.length, offset + Math.min(input.maxBytes, 12 * 1024));
      while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
      assert(
        end > offset || offset === bytes.length,
        'INVALID_ARGUMENT',
        '读取长度不足一个 UTF-8 字符。',
      );
      result.data = {
        ...artifact,
        content: bytes.subarray(offset, end).toString('utf8'),
        nextCursor: String(end),
        eof: end === bytes.length,
      };
      break;
    }
  }
}
