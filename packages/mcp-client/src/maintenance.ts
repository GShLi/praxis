import { randomUUID } from 'node:crypto';
import type { FetchLike } from '@modelcontextprotocol/client';
import { assert, PraxisError } from '../../contracts/src/index.ts';
import type { McpConfigService } from '../../mcp-core/src/index.ts';
import type { SessionStore } from '../../storage-local/src/index.ts';
import { McpConnection, mcpError } from './index.ts';

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
  private active = new Map<string, { cancel: AbortController; promise: Promise<McpTestResult> }>();
  private closed = false;
  constructor(
    private configs: McpConfigService,
    private store: SessionStore,
    private owner: string,
    private client: string,
    private fetch?: FetchLike,
  ) {}
  test(serverId: string, expectedRevision: number) {
    assert(!this.closed, 'MCP_CLOSED', 'MCP 已关闭。');
    assert(!this.active.has(serverId) && this.active.size < 4, 'MCP_BUSY', '连接检查正在进行。');
    const cancel = new AbortController();
    const promise = this.perform(serverId, expectedRevision, cancel.signal).finally(() =>
      this.active.delete(serverId),
    );
    this.active.set(serverId, { cancel, promise });
    return promise;
  }
  private async perform(serverId: string, expectedRevision: number, cancellation: AbortSignal) {
    const signal = AbortSignal.any([cancellation, AbortSignal.timeout(60_000)]);
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
      config.transport.auth.type === 'none',
      'MCP_AUTH_REQUIRED',
      '此连接需要先配置本地 MCP 凭据。',
    );
    signal.throwIfAborted();
    const operationId = randomUUID();
    this.store.startMaintenance(operationId, this.owner, serverId, config.revision);
    const connection = new McpConnection(
      config,
      {
        owner: this.owner,
        client: this.client,
        serverId,
        configRevision: config.revision,
        authEpoch: 0,
      },
      signal,
    );
    let result: McpTestResult | undefined, failure: PraxisError | undefined;
    try {
      await connection.connect(this.fetch ? { fetch: this.fetch } : {});
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
    return result!;
  }
  cancel(serverId: string) {
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
