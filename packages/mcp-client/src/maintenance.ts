import type { ResolveCredentials } from './credentials/service.ts';
import type { FetchLike } from '@modelcontextprotocol/client';
import { assert, PraxisError } from '@praxis/contracts';
import type { McpConfigService } from '@praxis/mcp-core';
import type { SessionStore } from '@praxis/storage-local';
import { randomUUID } from 'node:crypto';
import { McpConnection } from './connection.ts';
import { mcpError } from './errors.ts';

export interface McpTestResult {
  operationId: string;
  protocol: '2026-07-28' | '2025-11-25';
  toolCount: number;
  rejectedTools: number;
  generation: string;
  capabilities: { tools: boolean; resources: boolean; prompts: boolean };
}
/** User-initiated maintenance only. No credentials, model inputs or business calls. */
export class McpMaintenance {
  private tested = new Map<string, { revision: number; authEpoch: number }>();
  private active = new Map<string, { cancel: AbortController; promise: Promise<McpTestResult> }>();
  private closed = false;
  constructor(
    private configs: McpConfigService,
    private store: SessionStore,
    private owner: string,
    private client: string,
    private fetch?: FetchLike,
    private credentials?: ResolveCredentials,
  ) {}
  test(serverId: string, expectedRevision: number) {
    assert(!this.closed, 'MCP_CLOSED', 'MCP 已关闭。');
    assert(!this.active.has(serverId) && this.active.size < 4, 'MCP_BUSY', '连接检查正在进行。');
    this.tested.delete(serverId);
    const cancel = new AbortController();
    const promise = this.perform(serverId, expectedRevision, cancel.signal).finally(() =>
      this.active.delete(serverId),
    );
    this.active.set(serverId, { cancel, promise });
    return promise;
  }
  private async perform(serverId: string, expectedRevision: number, cancellation: AbortSignal) {
    const signal = AbortSignal.any([cancellation, AbortSignal.timeout(60_000)]);
    const config = await this.checkedConfig(serverId, expectedRevision, signal);
    const authentication =
      config.transport.type === 'streamable-http' && config.transport.auth.type !== 'none'
        ? await this.credentials?.(config, signal)
        : { authEpoch: 0 };
    assert(authentication, 'MCP_AUTH_REQUIRED', '此服务器需要本地凭据。');
    const operationId = randomUUID();
    this.store.startMaintenance(operationId, this.owner, serverId, config.revision);
    const connection = new McpConnection(
      config,
      {
        owner: this.owner,
        client: this.client,
        serverId,
        configRevision: config.revision,
        authEpoch: authentication.authEpoch,
      },
      signal,
    );
    let result: McpTestResult | undefined, failure: PraxisError | undefined;
    try {
      await connection.connect({
        ...(this.fetch ? { fetch: this.fetch } : {}),
        ...(authentication.bearer ? { bearer: authentication.bearer } : {}),
      });
      const catalog = await connection.catalog();
      const capabilities = connection.client.getServerCapabilities();
      const current = (await this.configs.file.read()).value.find((c) => c.id === serverId);
      assert(
        current?.revision === config.revision,
        'MCP_CONFIG_CHANGED',
        '连接检查期间配置已变化。',
      );
      signal.throwIfAborted();
      result = {
        operationId,
        protocol: catalog.protocol,
        toolCount: catalog.tools.length,
        rejectedTools: catalog.rejected.length,
        generation: catalog.generation,
        capabilities: {
          tools: Boolean(capabilities?.tools),
          resources: Boolean(capabilities?.resources),
          prompts: Boolean(capabilities?.prompts),
        },
      };
    } catch (error) {
      failure = mcpError(error, signal);
    } finally {
      await connection.close();
    }
    if (signal.aborted && !failure) failure = mcpError(signal.reason, signal);
    this.store.finishMaintenance(
      operationId,
      failure ? (signal.aborted ? 'cancelled' : 'failed') : 'succeeded',
      failure?.code,
    );
    if (failure) throw failure;
    this.tested.set(serverId, { revision: config.revision, authEpoch: authentication.authEpoch });
    return result!;
  }
  private async checkedConfig(serverId: string, expectedRevision: number, signal: AbortSignal) {
    const config = (await this.configs.file.read()).value.find((c) => c.id === serverId);
    assert(
      config && config.revision === expectedRevision,
      'MCP_CONFIG_CHANGED',
      '服务器配置已变化，请重新读取后检查。',
    );
    assert(
      config.transport.type === 'streamable-http',
      'MCP_SANDBOX_UNAVAILABLE',
      '本地 stdio 服务需要已验证的原生沙箱。',
    );
    assert(
      config.transport.auth.type === 'none' || this.credentials,
      'MCP_AUTH_REQUIRED',
      '此连接需要先配置本地 MCP 凭据。',
    );
    signal.throwIfAborted();
    return config;
  }
  async enable(serverId: string, expectedStoreRevision: number, expectedRevision: number) {
    const tested = this.tested.get(serverId);
    assert(
      !this.closed && tested?.revision === expectedRevision,
      'MCP_TEST_REQUIRED',
      '请先在当前客户端检查此配置，再明确启用。',
    );
    const signal = AbortSignal.timeout(15000);
    const config = await this.checkedConfig(serverId, expectedRevision, signal);
    const authentication =
      config.transport.type === 'streamable-http' && config.transport.auth.type !== 'none'
        ? await this.credentials?.(config, signal)
        : { authEpoch: 0 };
    assert(
      authentication?.authEpoch === tested.authEpoch,
      'MCP_TEST_REQUIRED',
      '认证已更新，请重新检查连接。',
    );
    return this.configs.enable(serverId, expectedStoreRevision, expectedRevision);
  }
  invalidateAuthentication(serverId: string) {
    this.tested.delete(serverId);
  }
  cancel(serverId: string) {
    this.tested.delete(serverId);
    this.active
      .get(serverId)
      ?.cancel.abort(new PraxisError('MCP_CONFIG_CHANGED', '服务器已停用或配置已变化。'));
  }
  async close() {
    this.closed = true;
    for (const entry of this.active.values()) entry.cancel.abort();
    await Promise.allSettled([...this.active.values()].map((entry) => entry.promise));
  }
}
