import type { ResolveCredentials, McpAuthentication } from './credentials/service.ts';
import type { Ask } from '@praxis/tools';
import { containsSecret } from './form.ts';
import type { FetchLike } from '@modelcontextprotocol/client';
import { fingerprint } from '@praxis/config';
import { assert, PraxisError, safeError } from '@praxis/contracts';
import type { McpConfig, McpConfigService } from '@praxis/mcp-core';
import type { Approve } from '@praxis/permissions';
import { randomUUID } from 'node:crypto';
import { McpConnection } from './connection.ts';
import { mcpError } from './errors.ts';
import { WorkspaceMcpPolicy } from './workspace-policy.ts';

export interface TurnScopeOptions {
  workspace?: WorkspaceMcpPolicy;
  configs: McpConfigService;
  owner: string;
  client: string;
  signal: AbortSignal;
  approve: Approve;
  continueApproval?: Approve;
  sensitiveValues: readonly string[];
  record(type: string, data: Record<string, unknown>): void;
  artifact(kind: string, content: string): string;
  fetch?: FetchLike;
  ask?: Ask;
  credentials?: ResolveCredentials;
}
export interface RemoteOperation {
  connection: McpConnection;
  operationId: string;
  signal: AbortSignal;
  authorize(): Promise<void>;
}
interface OperationPolicy {
  capability: 'tools' | 'resources' | 'prompts';
  metadataOnly: boolean;
}
/** Connections and tickets belong to a turn, never a global/shared SDK session. */
export class McpTurnScope {
  readonly workspace: WorkspaceMcpPolicy;
  private lifetime = new AbortController();
  private servers = new Map<string, AbortController>();
  private authentication = new Map<string, number>();
  private operations = new Set<Promise<unknown>>();
  constructor(
    readonly configs: readonly McpConfig[],
    readonly options: TurnScopeOptions,
  ) {
    this.workspace = options.workspace ?? new WorkspaceMcpPolicy();
  }
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
  invalidateAuthentication(id: string, epoch: number) {
    const bound = this.authentication.get(id);
    if (bound !== undefined && bound < epoch) this.invalidate(id);
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
    policy: OperationPolicy = { capability: 'tools', metadataOnly: false },
  ): Promise<T> {
    const task = this.perform(serverId, callId, toolId, parameters, action, policy).finally(() =>
      this.operations.delete(task),
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
    policy: OperationPolicy,
  ): Promise<T> {
    const { config, signal, authentication } = await this.prepare(serverId, policy.capability);
    const sensitiveValues = [
      ...this.options.sensitiveValues,
      ...(authentication.bearer ? [authentication.bearer] : []),
    ];
    assert(
      !containsSecret(parameters, sensitiveValues),
      'MCP_SECRET_DENIED',
      '请求参数包含已知凭据。',
    );
    const operationId = randomUUID();
    const details = { operationId, callId, serverId, configRevision: config.revision, toolId };
    const connection = new McpConnection(
      config,
      {
        owner: this.options.owner,
        client: this.options.client,
        serverId,
        configRevision: config.revision,
        authEpoch: authentication.authEpoch,
      },
      signal,
      {
        server: config.displayName,
        sensitiveValues,
        ...(!policy.metadataOnly && this.options.ask ? { ask: this.options.ask } : {}),
        record: (type, data) => this.record(type, { ...details, ...data }),
        beforeContinue: async (responses) => {
          await this.current(config, signal);
          if (Object.values(responses).some((r) => r.action === 'accept')) {
            const grant = await this.approval(
              config,
              callId,
              toolId,
              { original: parameters, inputResponses: responses },
              signal,
              this.options.continueApproval,
            );
            await this.current(config, signal);
            grant();
          }
        },
      },
    );
    this.record('mcp/operation-started', details);
    try {
      // Explicit enable authorizes bounded metadata only. Business parameters always need a new ticket.
      const grant = policy.metadataOnly
        ? undefined
        : await this.approval(config, callId, toolId, parameters, signal);
      await this.current(config, signal);
      await connection.connect({
        ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
        ...(authentication.bearer ? { bearer: authentication.bearer } : {}),
      });
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
  async check(serverId: string, capability: OperationPolicy['capability']) {
    await this.prepare(serverId, capability);
  }
  private async prepare(serverId: string, capability: OperationPolicy['capability']) {
    const config = this.configs.find((c) => c.id === serverId);
    assert(
      config?.enabled &&
        config.capabilities[capability] &&
        (capability !== 'tools' || this.workspace.toolsEnabled(serverId)),
      'MCP_NOT_ENABLED',
      '此服务器未启用所需能力。',
    );
    assert(
      config.transport.type === 'streamable-http',
      'MCP_TRANSPORT_UNAVAILABLE',
      '当前业务执行仅支持 HTTP 服务器。',
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
    let authentication: McpAuthentication = { authEpoch: 0 };
    if (config.transport.auth.type !== 'none') {
      assert(this.options.credentials, 'MCP_AUTH_REQUIRED', '此服务器需要本地凭据。');
      authentication = await this.options.credentials(config, signal);
      await this.current(config, signal);
    }
    this.authentication.set(serverId, authentication.authEpoch);
    return { config, signal, authentication };
  }
  private approval(
    config: McpConfig,
    callId: string,
    toolId: string,
    parameters: unknown,
    signal: AbortSignal,
    approve = this.options.approve,
  ) {
    assert(
      !containsSecret(parameters, this.options.sensitiveValues),
      'MCP_SECRET_DENIED',
      '工具参数包含已知凭据，不能发送至 MCP 服务器。',
    );
    assert(
      config.transport.type === 'streamable-http',
      'MCP_TRANSPORT_UNAVAILABLE',
      '不支持此传输。',
    );
    return approve(
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
  cancel() {
    this.lifetime.abort();
  }
  async close() {
    this.cancel();
    await Promise.allSettled([...this.operations]);
  }
}
