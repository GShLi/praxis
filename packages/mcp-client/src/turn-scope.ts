import type { FetchLike } from '@modelcontextprotocol/client';
import { fingerprint } from '@praxis/config';
import { assert, PraxisError, safeError } from '@praxis/contracts';
import type { McpConfig, McpConfigService } from '@praxis/mcp-core';
import type { Approve } from '@praxis/permissions';
import { randomUUID } from 'node:crypto';
import { McpConnection } from './connection.ts';
import { mcpError } from './errors.ts';

export interface TurnScopeOptions {
  configs: McpConfigService;
  owner: string;
  client: string;
  signal: AbortSignal;
  approve: Approve;
  sensitiveValues: readonly string[];
  record(type: string, data: Record<string, unknown>): void;
  artifact(kind: string, content: string): string;
  fetch?: FetchLike;
}
export interface RemoteOperation {
  connection: McpConnection;
  operationId: string;
  signal: AbortSignal;
  authorize(): Promise<void>;
}
/** Connections and tickets belong to a turn, never a global/shared SDK session. */
export class McpTurnScope {
  private lifetime = new AbortController();
  private servers = new Map<string, AbortController>();
  private operations = new Set<Promise<unknown>>();
  constructor(
    readonly configs: readonly McpConfig[],
    readonly options: TurnScopeOptions,
  ) {}
  record(type: string, data: Record<string, unknown>) {
    this.options.record(type, data);
  }
  artifact(kind: string, content: string) {
    return this.options.artifact(kind, content);
  }
  invalidate(id: string) {
    if (!this.configs.some((c) => c.id === id)) return;
    const scope = this.servers.get(id) ?? new AbortController();
    scope.abort(
      new PraxisError('MCP_CONFIG_CHANGED', '服务器配置已修改或停用；请开始新一轮任务。'),
    );
    this.servers.set(id, scope);
  }
  private async current(config: McpConfig, signal: AbortSignal) {
    signal.throwIfAborted();
    const now = (await this.options.configs.file.read()).value.find((c) => c.id === config.id);
    assert(
      now?.enabled && fingerprint(now) === fingerprint(config),
      'MCP_CONFIG_CHANGED',
      '服务器配置已修改或停用。',
    );
    signal.throwIfAborted();
  }
  run<T>(
    serverId: string,
    callId: string,
    toolId: string,
    parameters: unknown,
    action: (operation: RemoteOperation) => Promise<T>,
    metadataOnly = false,
  ): Promise<T> {
    const task = this.perform(serverId, callId, toolId, parameters, action, metadataOnly).finally(
      () => this.operations.delete(task),
    );
    this.operations.add(task);
    return task;
  }
  private async perform<T>(
    serverId: string,
    callId: string,
    toolId: string,
    parameters: unknown,
    action: (operation: RemoteOperation) => Promise<T>,
    metadataOnly: boolean,
  ): Promise<T> {
    const { config, signal } = await this.prepare(serverId);
    const operationId = randomUUID();
    const details = { operationId, callId, serverId, configRevision: config.revision, toolId };
    const connection = new McpConnection(
      config,
      {
        owner: this.options.owner,
        client: this.options.client,
        serverId,
        configRevision: config.revision,
        authEpoch: 0,
      },
      signal,
    );
    this.record('mcp/operation-started', details);
    try {
      // Explicit enable authorizes bounded metadata only. Business parameters always need a new ticket.
      const grant = metadataOnly
        ? undefined
        : await this.approval(config, callId, toolId, parameters, signal);
      await this.current(config, signal);
      await connection.connect(this.options.fetch ? { fetch: this.options.fetch } : {});
      const result = await action({
        connection,
        signal,
        operationId,
        authorize: async () => {
          await this.current(config, signal);
          grant?.();
        },
      });
      signal.throwIfAborted();
      this.record('mcp/operation-finished', { ...details, status: 'succeeded' });
      return result;
    } catch (error) {
      const failure = mcpError(error, signal);
      this.record('mcp/operation-finished', {
        ...details,
        status: signal.aborted ? 'cancelled' : 'failed',
        ...safeError(failure),
      });
      throw failure;
    } finally {
      await connection.close();
    }
  }
  private async prepare(serverId: string) {
    const config = this.configs.find((c) => c.id === serverId);
    assert(
      config?.enabled && config.capabilities.tools,
      'MCP_NOT_ENABLED',
      '此服务器未启用工具能力。',
    );
    assert(
      config.transport.type === 'streamable-http' && config.transport.auth.type === 'none',
      'MCP_TRANSPORT_UNAVAILABLE',
      '当前业务执行仅支持无认证 HTTP 服务器。',
    );
    const server = this.servers.get(serverId) ?? new AbortController();
    this.servers.set(serverId, server);
    const signal = AbortSignal.any([
      this.options.signal,
      this.lifetime.signal,
      server.signal,
      AbortSignal.timeout(300_000),
    ]);
    await this.current(config, signal);
    return { config, signal };
  }
  private approval(
    config: McpConfig,
    callId: string,
    toolId: string,
    parameters: unknown,
    signal: AbortSignal,
  ) {
    const serialized = JSON.stringify(parameters);
    assert(
      !this.options.sensitiveValues.some((value) => value && serialized.includes(value)),
      'MCP_SECRET_DENIED',
      '工具参数包含已知凭据，不能发送至 MCP 服务器。',
    );
    assert(
      config.transport.type === 'streamable-http',
      'MCP_TRANSPORT_UNAVAILABLE',
      '不支持此传输。',
    );
    return this.options.approve(
      {
        callId,
        toolId,
        parameters,
        reason: '允许向此 MCP 服务器发送所示参数并执行本次操作？远端效果无法由本地沙箱限制。',
        resources: {
          server: config.displayName,
          endpoint: config.transport.endpoint,
          configRevision: String(config.revision),
        },
      },
      signal,
    );
  }
  async close() {
    this.lifetime.abort();
    await Promise.allSettled([...this.operations]);
  }
}
