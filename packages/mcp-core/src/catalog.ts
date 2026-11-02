import { fingerprint } from '@praxis/config';
import { assert, safeError } from '@praxis/contracts';
import { z } from 'zod';
import type { Catalog, CatalogBinding, CatalogTool, MetadataRpc } from './catalog-types.ts';
import { text } from './config.ts';
import { catalogTool } from './catalog-tool.ts';

export class McpCatalog {
  private current: Catalog | undefined;
  snapshot() {
    return this.current;
  }
  invalidate() {
    if (this.current) this.current.stale = true;
  }
  async refresh(
    binding: CatalogBinding,
    namespace: string,
    protocol: Catalog['protocol'],
    instructions: string,
    rpc: MetadataRpc,
    signal: AbortSignal,
  ) {
    assert(Buffer.byteLength(instructions) <= 8192, 'MCP_CATALOG_LIMIT', '服务器说明超过 8 KiB。');
    const tools: CatalogTool[] = [],
      rejected: Catalog['rejected'] = [],
      seen = new Set<string>(),
      cursors = new Set<string>(),
      modelNames = new Set<string>();
    let cursor: string | undefined,
      bytes = Buffer.byteLength(instructions),
      count = 0;
    try {
      for (let page = 0; page < 20; page++) {
        signal.throwIfAborted();
        const raw = await rpc('tools/list', cursor ? { cursor } : {}, signal);
        bytes += Buffer.byteLength(JSON.stringify(raw));
        assert(bytes <= 8 * 1024 * 1024, 'MCP_CATALOG_LIMIT', '目录超过 8 MiB。');
        const response = z
          .object({
            tools: z.array(z.object({ name: text }).passthrough()),
            nextCursor: z.string().min(1).max(4096).optional(),
          })
          .parse(raw);
        for (const entry of response.tools) {
          assert(!seen.has(entry.name), 'MCP_CATALOG_INVALID', '服务器返回了重复工具名。');
          seen.add(entry.name);
          assert(++count <= 200, 'MCP_CATALOG_LIMIT', '服务器工具超过 200 项。');
          try {
            tools.push(catalogTool(entry, binding, namespace, modelNames));
          } catch (error) {
            const code = safeError(error).code;
            if (code === 'MCP_NAME_COLLISION') throw error;
            rejected.push({ name: entry.name, code });
          }
        }
        cursor = response.nextCursor;
        if (!cursor) break;
        assert(
          !cursors.has(cursor) && page < 19,
          'MCP_CATALOG_INVALID',
          '目录游标循环或页数超限。',
        );
        cursors.add(cursor);
      }
      signal.throwIfAborted();
      const generation = fingerprint({
        binding,
        protocol,
        instructions,
        tools: tools.map(({ validate: _validate, ...tool }) => tool),
        rejected,
      });
      this.current = {
        binding: structuredClone(binding),
        generation,
        protocol,
        instructions,
        tools,
        rejected,
        fetchedAt: Date.now(),
        stale: false,
      };
      return this.current;
    } catch (error) {
      this.invalidate();
      throw error;
    }
  }
}
