import { assert, PraxisError } from '@praxis/contracts';
import type { McpConfig, McpConfigService } from '@praxis/mcp-core';
import { randomUUID } from 'node:crypto';
import { containsSecret } from '../form.ts';
import type { SecretStore } from './secret-store.ts';
import { credentialKey, credentialReference } from './references.ts';

export interface McpAuthentication {
  authEpoch: number;
  bearer?: string;
}
export type ResolveCredentials = (
  config: McpConfig,
  signal: AbortSignal,
) => Promise<McpAuthentication>;

/** Config publication follows secret storage; edits revoke old execution through ConfigService. */
export class McpCredentials {
  private closed = false;
  private lifetime = new AbortController();
  private pending = new Set<Promise<unknown>>();
  constructor(
    private configs: McpConfigService,
    private secrets: SecretStore,
    private owner: string,
    private client: string,
    private protectedValues: readonly string[] = [],
  ) {}
  private key(config: McpConfig, id: string) {
    return credentialKey(config, this.owner, this.client, id);
  }
  private async checked(serverId: string, expectedStoreRevision: number, expectedRevision: number) {
    assert(!this.closed, 'SECRET_STORE_CLOSED', '凭据存储已关闭。');
    const state = await this.configs.file.read(),
      config = state.value.find((c) => c.id === serverId);
    assert(
      config && state.revision === expectedStoreRevision && config.revision === expectedRevision,
      'CONFIG_CONFLICT',
      '服务器配置已变化，请刷新后重试。',
    );
    assert(
      config.transport.type === 'streamable-http',
      'MCP_AUTH_UNSUPPORTED',
      '请选择固定的 HTTP 服务器。',
    );
    return config;
  }
  setBearer(
    serverId: string,
    expectedStoreRevision: number,
    expectedRevision: number,
    token: string,
  ) {
    return this.track(async () => {
      assert(
        /^[\x21-\x7e]+$/.test(token) && token.length <= 8192,
        'MCP_CREDENTIAL_INVALID',
        'Bearer 格式无效。',
      );
      assert(
        !containsSecret(token, this.protectedValues),
        'MCP_SECRET_DENIED',
        '不能将 Praxis 或模型凭据用作 MCP Token。',
      );
      const config = await this.checked(serverId, expectedStoreRevision, expectedRevision);
      const id = randomUUID(),
        key = this.key(config, id);
      const storage = await this.secrets.put(key, token, this.lifetime.signal);
      let published = false;
      try {
        assert(!this.closed, 'SECRET_STORE_CLOSED', '凭据存储已关闭。');
        const result = await this.configs.upsert(
          {
            ...config,
            transport: {
              ...config.transport,
              auth: { type: 'bearer', credentialRef: `${storage}:${config.revision + 1}:${id}` },
            },
          },
          expectedStoreRevision,
          expectedRevision,
        );
        published = true;
        await this.remove(config);
        return result;
      } finally {
        if (!published) await this.secrets.delete(key, storage);
      }
    });
  }
  clear(serverId: string, expectedStoreRevision: number, expectedRevision: number) {
    return this.track(async () => {
      const config = await this.checked(serverId, expectedStoreRevision, expectedRevision);
      const result = await this.configs.upsert(
        { ...config, transport: { ...config.transport, auth: { type: 'none' } } },
        expectedStoreRevision,
        expectedRevision,
      );
      await this.remove(config);
      return result;
    });
  }
  async resolve(config: McpConfig, signal: AbortSignal): Promise<McpAuthentication> {
    assert(!this.closed, 'SECRET_STORE_CLOSED', '凭据存储已关闭。');
    assert(
      config.transport.type === 'streamable-http',
      'MCP_AUTH_UNSUPPORTED',
      '不支持此凭据类型。',
    );
    if (config.transport.auth.type === 'none') return { authEpoch: 0 };
    assert(config.transport.auth.type === 'bearer', 'MCP_AUTH_REQUIRED', '请先完成 OAuth 授权。');
    const ref = credentialReference(config);
    const bearer = await this.secrets.get(this.key(config, ref.id), ref.storage, signal);
    assert(bearer, 'MCP_AUTH_REQUIRED', '当前客户端没有可用的 MCP 凭据，请在设置中重新填写。');
    return { bearer, authEpoch: ref.epoch };
  }
  status(config: McpConfig): {
    type: 'none' | 'bearer' | 'oauth';
    storage: 'os' | 'memory' | 'missing' | null;
  } {
    if (config.transport.type !== 'streamable-http' || config.transport.auth.type === 'none')
      return { type: 'none', storage: null };
    const type = config.transport.auth.type;
    try {
      const ref = credentialReference(config);
      return {
        type,
        storage:
          ref.storage === 'memory' && !this.secrets.hasMemory(this.key(config, ref.id))
            ? 'missing'
            : ref.storage,
      };
    } catch {
      return { type, storage: 'missing' };
    }
  }
  private async remove(config: McpConfig) {
    if (config.transport.type !== 'streamable-http' || config.transport.auth.type === 'none')
      return;
    const ref = credentialReference(config);
    await this.secrets.delete(this.key(config, ref.id), ref.storage);
  }
  private track<T>(action: () => Promise<T>) {
    const task = Promise.resolve()
      .then(action)
      .finally(() => this.pending.delete(task));
    this.pending.add(task);
    return task;
  }
  async close() {
    this.closed = true;
    this.lifetime.abort(new PraxisError('SECRET_STORE_CLOSED', '凭据服务已关闭。'));
    await Promise.allSettled([...this.pending]);
    await this.secrets.close();
  }
}
