import { refreshAuthorization } from '@modelcontextprotocol/client';
import { fingerprint } from '@praxis/config';
import { assert, PraxisError } from '@praxis/contracts';
import type { McpConfig } from '@praxis/mcp-core';
import type { CredentialRecords } from '../credentials/records.ts';
import { credentialReference } from '../credentials/references.ts';
import { containsSecret } from '../form.ts';
import { OAuthNetwork } from './network.ts';
import { oauthAccountSchema, type OAuthAccount } from './schema.ts';
import { applyTokens } from './tokens.ts';

interface RefreshJob {
  promise: Promise<OAuthAccount>;
  cancel: AbortController;
  waiters: number;
  serverId: string;
}
export class OAuthAccounts {
  private active = new Map<string, RefreshJob>();
  constructor(
    private records: CredentialRecords,
    private protectedValues: readonly string[],
    private changed: (serverId: string, epoch: number) => void,
  ) {}
  private async read(config: McpConfig, signal: AbortSignal) {
    assert(
      config.transport.type === 'streamable-http' && config.transport.auth.type === 'oauth',
      'MCP_AUTH_REQUIRED',
      '缺少 OAuth 凭据。',
    );
    const ref = credentialReference(config);
    const raw = await this.records.secrets.get(
      this.records.key(config, ref.id),
      ref.storage,
      signal,
    );
    assert(raw, 'MCP_AUTH_REQUIRED', '当前客户端没有 OAuth 凭据，请重新授权。');
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new PraxisError('MCP_AUTH_REQUIRED', 'OAuth 凭据格式无效，请重新授权。');
    }
    const parsed = oauthAccountSchema.safeParse(value);
    assert(parsed.success, 'MCP_AUTH_REQUIRED', 'OAuth 凭据格式无效，请重新授权。');
    const account = parsed.data;
    assert(
      account.resource === new URL(config.transport.endpoint).href &&
        account.metadata.issuer === account.issuer &&
        fingerprint({
          issuer: account.issuer,
          resource: account.resource,
          clientId: account.clientId,
          redirectUri: account.redirectUri,
        }) === config.transport.auth.registrationRef,
      'MCP_OAUTH_BINDING',
      'OAuth 凭据不属于当前资源或客户端注册。',
    );
    assert(
      account.state === 'ready',
      'MCP_AUTH_REQUIRED',
      '上次 Token 刷新未确认完成，请重新授权。',
    );
    return account;
  }
  async resolve(config: McpConfig, signal: AbortSignal) {
    const ref = credentialReference(config);
    const existing = this.active.get(this.records.key(config, ref.id));
    const account = existing ? await this.wait(existing, signal) : await this.read(config, signal);
    const current =
      account.expiresAt !== null && account.expiresAt <= Date.now() + 30000
        ? await this.refresh(config, signal)
        : account;
    signal.throwIfAborted();
    return { bearer: current.accessToken, authEpoch: current.authEpoch };
  }
  private refresh(config: McpConfig, signal: AbortSignal) {
    const ref = credentialReference(config),
      key = this.records.key(config, ref.id);
    let job = this.active.get(key);
    if (!job) {
      const cancel = new AbortController();
      const scope = AbortSignal.any([
        this.records.signal,
        cancel.signal,
        AbortSignal.timeout(30000),
      ]);
      const promise = this.rotate(config, scope).finally(() => this.active.delete(key));
      job = { cancel, promise, waiters: 0, serverId: config.id };
      this.active.set(key, job);
    }
    return this.wait(job, signal);
  }
  private async wait(job: RefreshJob, signal: AbortSignal) {
    job.waiters++;
    let abort = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new PraxisError('MCP_OAUTH_CANCELLED', 'Token 刷新等待已取消。'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    try {
      return await Promise.race([job.promise, cancelled]);
    } finally {
      signal.removeEventListener('abort', abort);
      if (--job.waiters === 0) job.cancel.abort();
    }
  }
  private async rotate(config: McpConfig, signal: AbortSignal): Promise<OAuthAccount> {
    const ref = credentialReference(config),
      key = this.records.key(config, ref.id);
    const old = await this.read(config, signal);
    if (old.expiresAt === null || old.expiresAt > Date.now() + 30000) return old;
    assert(old.refreshToken, 'MCP_AUTH_REQUIRED', 'Token 已过期且没有 Refresh Token，请重新授权。');
    await this.records.secrets.replace(
      key,
      JSON.stringify({ ...old, state: 'refreshing' }),
      ref.storage,
      signal,
    );
    try {
      const network = new OAuthNetwork(signal);
      network.allow(
        old.metadata.token_endpoint,
        'POST',
        old.allowPrivateIssuer &&
          new URL(old.metadata.token_endpoint).origin === new URL(old.issuer).origin,
      );
      const tokens = await refreshAuthorization(old.issuer, {
        metadata: old.metadata,
        clientInformation: { client_id: old.clientId },
        refreshToken: old.refreshToken,
        resource: new URL(old.resource),
        fetchFn: network.fetch,
      });
      const next = applyTokens(
        { ...old, authEpoch: Math.max(Date.now(), old.authEpoch + 1) },
        tokens,
      );
      assert(
        !containsSecret(next, this.protectedValues),
        'MCP_SECRET_DENIED',
        'Token 响应包含其他已知凭据。',
      );
      await this.stillCurrent(config, signal);
      await this.records.secrets.replace(key, JSON.stringify(next), ref.storage, signal);
      try {
        await this.stillCurrent(config, signal);
      } catch (error) {
        // A concurrent clear/rotation must not leave a newly recreated, unreachable OS entry.
        const current = (await this.records.configs.file.read()).value.find(
          (c) => c.id === config.id,
        );
        if (!current || fingerprint(current.transport) !== fingerprint(config.transport))
          await this.records.secrets.delete(key, ref.storage);
        throw error;
      }
      this.changed(config.id, next.authEpoch);
      return next;
    } catch (error) {
      if (error instanceof PraxisError) throw error;
      throw new PraxisError(
        'MCP_AUTH_REQUIRED',
        'Token 刷新失败；为避免重复使用旧凭据，请重新授权。',
      );
    }
  }
  private async stillCurrent(config: McpConfig, signal: AbortSignal) {
    signal.throwIfAborted();
    const current = (await this.records.configs.file.read()).value.find((c) => c.id === config.id);
    assert(
      current && fingerprint(current.transport) === fingerprint(config.transport),
      'MCP_CONFIG_CHANGED',
      '刷新期间服务器认证配置已变化。',
    );
  }
  async close() {
    for (const job of this.active.values()) job.cancel.abort();
    await Promise.allSettled([...this.active.values()].map((job) => job.promise));
  }
  invalidate(serverId: string) {
    for (const job of this.active.values()) if (job.serverId === serverId) job.cancel.abort();
  }
}
