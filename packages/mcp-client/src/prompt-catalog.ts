import { fingerprint } from '@praxis/config';
import { assert, mcpPromptEntrySchema, type McpPromptEntry } from '@praxis/contracts';
import { z } from 'zod';
import type { McpConnection } from './connection.ts';
const pageSchema = z.object({
  prompts: z.array(mcpPromptEntrySchema).max(200),
  nextCursor: z.string().min(1).max(4096).optional(),
});
export async function promptCatalog(connection: McpConnection, signal: AbortSignal) {
  assert(
    connection.config.capabilities.prompts && connection.client.getServerCapabilities()?.prompts,
    'MCP_CAPABILITY_UNSUPPORTED',
    '此服务器未提供提示词能力。',
  );
  const entries: McpPromptEntry[] = [],
    names = new Set<string>(),
    cursors = new Set<string>();
  let cursor: string | undefined,
    bytes = 0;
  for (let page = 0; page < 20; page++) {
    const raw = await connection.client.request(
      { method: 'prompts/list', params: cursor ? { cursor } : {} },
      { signal, timeout: 10000, maxTotalTimeout: 10000, resetTimeoutOnProgress: false },
    );
    bytes += Buffer.byteLength(JSON.stringify(raw));
    assert(bytes <= 2 * 1024 * 1024, 'MCP_CATALOG_LIMIT', '提示词目录超过 2 MiB。');
    const data = pageSchema.parse(raw);
    for (const entry of data.prompts) {
      assert(
        !names.has(entry.name) &&
          new Set(entry.arguments.map((a) => a.name)).size === entry.arguments.length,
        'MCP_CATALOG_INVALID',
        '提示词目录包含重复名称或参数。',
      );
      names.add(entry.name);
      entries.push(entry);
      assert(entries.length <= 200, 'MCP_CATALOG_LIMIT', '提示词目录超过 200 项。');
    }
    cursor = data.nextCursor;
    if (!cursor) break;
    assert(
      !cursors.has(cursor) && page < 19,
      'MCP_CATALOG_INVALID',
      '提示词目录游标循环或页数超限。',
    );
    cursors.add(cursor);
  }
  signal.throwIfAborted();
  const snapshot = {
    binding: connection.binding,
    protocol: connection.client.getNegotiatedProtocolVersion(),
    entries,
  };
  return {
    ...snapshot,
    generation: fingerprint(snapshot),
    serverId: connection.binding.serverId,
    configRevision: connection.binding.configRevision,
  };
}
export function validatePromptArguments(entry: McpPromptEntry, args: Record<string, string>) {
  assert(
    Buffer.byteLength(JSON.stringify(args)) <= 64 * 1024 &&
      Object.keys(args).every((name) => entry.arguments.some((a) => a.name === name)) &&
      entry.arguments.every((a) => !a.required || Object.hasOwn(args, a.name)),
    'MCP_PROMPT_ARGUMENTS',
    '参数必须与已选择提示词一致，累计不能超过 64 KiB。',
  );
}
