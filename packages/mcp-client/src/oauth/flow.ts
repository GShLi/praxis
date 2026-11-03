import { startAuthorization } from '@modelcontextprotocol/client';
import { fingerprint } from '@praxis/config';
import {
  assert,
  PraxisError,
  safeError,
  type McpOAuthStart,
  type McpOAuthStarted,
  type McpOAuthStatus,
} from '@praxis/contracts';
import { randomBytes, randomUUID } from 'node:crypto';
import type { CredentialRecords } from '../credentials/records.ts';
import { containsSecret } from '../form.ts';
import { OAuthCallback } from './callback.ts';
import { discoverOAuth } from './discovery.ts';
import { exchangeCode } from './exchange.ts';
import type { McpConfig } from '@praxis/mcp-core';
import type { OAuthAccount } from './schema.ts';

export class OAuthFlow {
  readonly id = randomUUID();
  private controller = new AbortController();
  private snapshot: McpOAuthStatus = { id: this.id, status: 'waiting' };
  private ready!: (value: McpOAuthStarted) => void;
  private failed!: (error: Error) => void;
  readonly started = new Promise<McpOAuthStarted>((resolve, reject) => {
    this.ready = resolve;
    this.failed = reject;
  });
  readonly completed: Promise<McpOAuthStatus>;
  committing = false;
  constructor(
    readonly input: McpOAuthStart,
    private records: CredentialRecords,
    private protectedValues: readonly string[],
  ) {
    this.completed = this.perform();
  }
  status() {
    return { ...this.snapshot };
  }
  cancel() {
    this.controller.abort();
  }
  private async perform() {
    const expiresAt = Date.now() + 300000;
    const signal = AbortSignal.any([
      this.controller.signal,
      this.records.signal,
      AbortSignal.timeout(300000),
    ]);
    let callback: OAuthCallback | undefined;
    try {
      const { config, resource, metadata } = await this.prepare(signal);
      const state = randomBytes(32).toString('base64url');
      callback = await OAuthCallback.open(this.input.redirectUri, state, signal);
      const { authorizationUrl, codeVerifier } = await startAuthorization(this.input.issuer, {
        metadata,
        clientInformation: { client_id: this.input.clientId },
        redirectUrl: this.input.redirectUri,
        scope: this.input.scopes.join(' '),
        state,
        resource: new URL(resource),
      });
      signal.throwIfAborted();
      this.ready({ id: this.id, authorizationUrl: authorizationUrl.href, expiresAt });
      const reply = await callback.reply;
      this.snapshot = { id: this.id, status: 'exchanging' };
      const account = await exchangeCode(
        this.input,
        metadata,
        resource,
        codeVerifier,
        reply,
        signal,
      );
      await this.publish(config, account, signal);
      this.snapshot = { id: this.id, status: 'succeeded' };
    } catch (error) {
      const failure = signal.aborted
        ? new PraxisError('MCP_OAUTH_CANCELLED', '授权已取消或超时。')
        : error instanceof PraxisError
          ? error
          : new PraxisError(
              'MCP_OAUTH_FAILED',
              'OAuth 授权失败，请核对服务器、客户端注册和权限范围。',
            );
      this.snapshot = {
        id: this.id,
        status: signal.aborted ? 'cancelled' : 'failed',
        error: safeError(failure),
      };
      this.failed(failure);
    } finally {
      await callback?.close();
    }
    return this.status();
  }
  private async prepare(signal: AbortSignal) {
    const config = await this.records.checked(
      this.input.serverId,
      this.input.expectedStoreRevision,
      this.input.expectedRevision,
    );
    assert(
      config.transport.type === 'streamable-http',
      'MCP_AUTH_UNSUPPORTED',
      'OAuth 仅支持 HTTP 服务器。',
    );
    const resource = new URL(config.transport.endpoint).href;
    const metadata = await discoverOAuth(
      resource,
      config.transport.allowPrivateDestination,
      this.input,
      AbortSignal.any([signal, AbortSignal.timeout(20000)]),
    );
    return { config, resource, metadata };
  }
  private async publish(config: McpConfig, account: OAuthAccount, signal: AbortSignal) {
    assert(
      !containsSecret(account, this.protectedValues),
      'MCP_SECRET_DENIED',
      '授权响应包含其他已知凭据。',
    );
    signal.throwIfAborted();
    this.committing = true;
    await this.records.publish(
      config,
      this.input.expectedStoreRevision,
      JSON.stringify(account),
      fingerprint({
        issuer: account.issuer,
        resource: account.resource,
        clientId: account.clientId,
        redirectUri: account.redirectUri,
      }),
      signal,
    );
  }
}
