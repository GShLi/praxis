import { fingerprint } from '@praxis/config';
import { assert, type ToolResult } from '@praxis/contracts';
import type { McpConnection } from './connection.ts';
import { mcpError } from './errors.ts';
import { resourceCatalog, type ResourceCatalog } from './resource-catalog.ts';
import { resourceContent, resourceUri } from './resource-content.ts';
import { ResourceReferences } from './resource-references.ts';
import { resourceDefinitions, resourceListSchema, resourceReadSchema } from './resource-schema.ts';
import type { McpTurnScope } from './turn-scope.ts';

export class McpResourceTools {
  private references = new ResourceReferences();
  readonly definitions;
  constructor(private scope: McpTurnScope) {
    this.definitions = resourceDefinitions(scope.configs);
  }
  handles(name: string) {
    return this.definitions.some((d) => d.modelName === name);
  }
  async execute(name: string, input: unknown, signal: AbortSignal, result: ToolResult) {
    signal.throwIfAborted();
    if (name === 'mcp_list_resources') result.data = await this.list(input, result.callId);
    else result.data = await this.read(input, result);
  }
  private async list(input: unknown, callId: string) {
    const args = resourceListSchema.parse(input);
    if (args.cursor) {
      const page = this.references.page(args.cursor, args.serverId, args.kind, args.limit);
      await this.scope.check(args.serverId, 'resources');
      return this.page(page.catalog, page.offset, args.limit);
    }
    this.references.invalidate(args.serverId, args.kind);
    return this.scope.run(
      args.serverId,
      callId,
      'mcp.list_resources',
      args,
      async ({ connection, signal, authorize, operationId }) => {
        await authorize();
        const catalog = await resourceCatalog(connection, args.kind, signal);
        const artifactId = this.scope.artifact('mcp-resource-catalog', JSON.stringify(catalog));
        this.scope.record('mcp/resource-catalog', {
          operationId,
          artifactId,
          ...catalog.binding,
          kind: catalog.kind,
          generation: catalog.generation,
        });
        this.references.remember(catalog);
        return this.page(catalog, 0, args.limit);
      },
      { capability: 'resources', metadataOnly: true },
    );
  }
  private page(catalog: ResourceCatalog, offset: number, limit: number) {
    const entries = catalog.entries.slice(offset, offset + limit).map((entry) => ({
      ...entry,
      ...('uri' in entry
        ? { resourceRef: this.references.issue({ type: 'resource', catalog, entry }) }
        : { templateRef: this.references.issue({ type: 'template', catalog, entry }) }),
    }));
    return {
      serverId: catalog.binding.serverId,
      generation: catalog.generation,
      entries,
      source: 'remote MCP metadata; not local paths or authorization',
      ...(offset + limit < catalog.entries.length
        ? {
            nextCursor: this.references.issue({
              type: 'page',
              catalog,
              offset: offset + limit,
              limit,
            }),
          }
        : {}),
    };
  }
  private async read(input: unknown, result: ToolResult) {
    const args = resourceReadSchema.parse(input);
    const value = this.references.read('resourceRef' in args ? args.resourceRef : args.templateRef);
    assert(
      value.type === ('resourceRef' in args ? 'resource' : 'template'),
      'MCP_REFERENCE_EXPIRED',
      '引用类型不匹配。',
    );
    const uri = resourceUri(value.entry, 'arguments' in args ? args.arguments : undefined);
    const { catalog } = value;
    return this.scope.run(
      catalog.binding.serverId,
      result.callId,
      'mcp.read_resource',
      { ...args, uri },
      async ({ connection, signal, authorize, operationId }) => {
        const fresh = await resourceCatalog(connection, catalog.kind, signal);
        if (fresh.generation !== catalog.generation)
          this.references.invalidate(catalog.binding.serverId, catalog.kind);
        assert(
          fresh.generation === catalog.generation,
          'MCP_CATALOG_CHANGED',
          '资源目录已变化，请重新列出资源。',
        );
        await authorize();
        this.scope.record('mcp/dispatch', {
          operationId,
          callId: result.callId,
          serverId: catalog.binding.serverId,
          configRevision: catalog.binding.configRevision,
          uri,
          argumentsHash: fingerprint({ uri }),
        });
        result.effectState = 'unknown';
        const content = await this.content(connection, signal, uri, result);
        return {
          origin: 'mcp-resource',
          serverId: catalog.binding.serverId,
          uri,
          operationId,
          ...content,
        };
      },
      { capability: 'resources', metadataOnly: false },
    );
  }
  private async content(
    connection: McpConnection,
    signal: AbortSignal,
    uri: string,
    result: ToolResult,
  ) {
    try {
      const raw = await connection.interact((continuation) =>
        connection.client.readResource(
          { uri, ...continuation },
          {
            signal,
            cacheMode: 'bypass',
            allowInputRequired: true,
            timeout: 60_000,
            maxTotalTimeout: 60_000,
            resetTimeoutOnProgress: false,
          },
        ),
      );
      signal.throwIfAborted();
      const normalized = resourceContent(raw);
      const artifactId = this.scope.artifact('mcp-resource', JSON.stringify(normalized));
      result.artifactIds.push(artifactId);
      if (!normalized.contents.length && normalized.unsupportedContent.length) {
        result.status = 'failed';
        result.error = {
          code: 'MCP_CONTENT_UNSUPPORTED',
          message: '此资源只包含当前不支持的内容。',
        };
      }
      return { fetchedAt: new Date().toISOString(), artifactId, ...normalized };
    } catch (error) {
      throw mcpError(error, signal);
    }
  }
}
