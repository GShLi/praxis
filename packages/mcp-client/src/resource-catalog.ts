import { fingerprint } from '@praxis/config';
import { assert } from '@praxis/contracts';
import type { CatalogBinding } from '@praxis/mcp-core';
import { z } from 'zod';
import type { McpConnection } from './connection.ts';
import { mcpError } from './errors.ts';

export type ResourceKind = 'resources' | 'templates';
const entry = z.object({
  name: z.string().min(1).max(4096),
  description: z.string().max(16384).optional(),
  mimeType: z.string().max(256).optional(),
});
const resource = entry.extend({ uri: z.string().min(1).max(4096) });
const template = entry.extend({ uriTemplate: z.string().min(1).max(4096) });
export type ResourceEntry = z.infer<typeof resource> | z.infer<typeof template>;
export interface ResourceCatalog {
  binding: CatalogBinding;
  kind: ResourceKind;
  generation: string;
  entries: ResourceEntry[];
  protocol: string;
  instructions: string;
}

export async function resourceCatalog(
  connection: McpConnection,
  kind: ResourceKind,
  signal: AbortSignal,
): Promise<ResourceCatalog> {
  assert(
    connection.config.capabilities.resources &&
      connection.client.getServerCapabilities()?.resources,
    'MCP_CAPABILITY_UNSUPPORTED',
    '此服务器未提供资源能力。',
  );
  const entries: ResourceEntry[] = [],
    seen = new Set<string>(),
    cursors = new Set<string>();
  let cursor: string | undefined,
    bytes = 0;
  try {
    for (let page = 0; page < 20; page++) {
      signal.throwIfAborted();
      const raw = connection.safeResult(
        await connection.client.request(
          {
            method: kind === 'resources' ? 'resources/list' : 'resources/templates/list',
            params: cursor ? { cursor } : {},
          },
          { signal, timeout: 10_000, maxTotalTimeout: 10_000, resetTimeoutOnProgress: false },
        ),
      );
      bytes += Buffer.byteLength(JSON.stringify(raw));
      assert(bytes <= 8 * 1024 * 1024, 'MCP_CATALOG_LIMIT', '资源目录超过 8 MiB。');
      const pageData = z
        .object({ nextCursor: z.string().min(1).max(4096).optional() })
        .passthrough()
        .parse(raw);
      const values =
        kind === 'resources'
          ? z.array(resource).parse(pageData.resources)
          : z.array(template).parse(pageData.resourceTemplates);
      for (const value of values) {
        const id = 'uri' in value ? value.uri : value.uriTemplate;
        assert(!seen.has(id), 'MCP_CATALOG_INVALID', '资源目录包含重复 URI。');
        seen.add(id);
        entries.push(value);
        assert(entries.length <= 200, 'MCP_CATALOG_LIMIT', '资源目录超过 200 项。');
      }
      cursor = pageData.nextCursor;
      if (!cursor) break;
      assert(
        !cursors.has(cursor) && page < 19,
        'MCP_CATALOG_INVALID',
        '资源目录游标循环或页数超限。',
      );
      cursors.add(cursor);
    }
    signal.throwIfAborted();
    return snapshot(connection, kind, entries);
  } catch (error) {
    throw mcpError(error, signal);
  }
}

function snapshot(connection: McpConnection, kind: ResourceKind, entries: ResourceEntry[]) {
  const binding = connection.binding;
  const instructions = connection.safeResult(connection.client.getInstructions() ?? '');
  const protocol = connection.client.getNegotiatedProtocolVersion();
  assert(protocol, 'MCP_NOT_CONNECTED', 'MCP 尚未连接。');
  assert(Buffer.byteLength(instructions) <= 8192, 'MCP_CATALOG_LIMIT', '服务器说明超过 8 KiB。');
  const snapshot = {
    binding,
    kind,
    entries,
    protocol,
    instructions,
  };
  return { ...snapshot, generation: fingerprint(snapshot) };
}
