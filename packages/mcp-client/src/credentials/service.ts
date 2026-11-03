import { assert, PraxisError } from '@praxis/contracts';
import type { McpConfig, McpConfigService } from '@praxis/mcp-core';
import { containsSecret } from '../form.ts';
import type { SecretStore } from './secret-store.ts';
import { credentialReference } from './references.ts';
import { CredentialRecords } from './records.ts';
import { McpOAuth } from '../oauth/service.ts';

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
  readonly oauth: McpOAuth;
  private records: CredentialRecords;
  private closed = false;
  private lifetime = new AbortController();
  private pending = new Set<Promise<unknown>>();
  constructor(
    private configs: McpConfigService,
    private secrets: SecretStore,
    owner: string,
    client: string,
    private protectedValues: readonly string[] = [],
    authenticationChanged: (serverId: string, epoch: number) => void = () => {},
  ) {
    this.records = new CredentialRecords(configs, secrets, owner, client, this.lifetime.signal);
    this.oauth = new McpOAuth(this.records, protectedValues, authenticationChanged);
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
      const config = await this.records.checked(serverId, expectedStoreRevision, expectedRevision);
      return this.records.publish(config, expectedStoreRevision, token);
    });
  }
  clear(serverId: string, expectedStoreRevision: number, expectedRevision: number) {
    return this.track(async () => {
      const config = await this.records.checked(serverId, expectedStoreRevision, expectedRevision);
      const result = await this.configs.upsert(
        { ...config, transport: { ...config.transport, auth: { type: 'none' } } },
        expectedStoreRevision,
        expectedRevision,
      );
      await this.records.remove(config);
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
    if (config.transport.auth.type === 'oauth') return this.oauth.resolve(config, signal);
    const ref = credentialReference(config);
    const bearer = await this.secrets.get(this.records.key(config, ref.id), ref.storage, signal);
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
          ref.storage === 'memory' && !this.secrets.hasMemory(this.records.key(config, ref.id))
            ? 'missing'
            : ref.storage,
      };
    } catch {
      return { type, storage: 'missing' };
    }
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
    await this.oauth.close();
    await Promise.allSettled([...this.pending]);
    await this.secrets.close();
  }
}
