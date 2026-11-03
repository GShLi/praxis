import { assert } from '@praxis/contracts';
import type { McpConfig, McpConfigService } from '@praxis/mcp-core';
import { randomUUID } from 'node:crypto';
import { credentialKey, credentialReference } from './references.ts';
import type { SecretStore } from './secret-store.ts';

/** A secret is stored before its reference is published with a config compare-and-swap. */
export class CredentialRecords {
  constructor(
    readonly configs: McpConfigService,
    readonly secrets: SecretStore,
    private owner: string,
    private client: string,
    readonly signal: AbortSignal,
    private stopRefreshes: (serverId: string) => Promise<void>,
  ) {}
  key(config: McpConfig, id: string) {
    return credentialKey(config, this.owner, this.client, id);
  }
  async checked(serverId: string, expectedStoreRevision: number, expectedRevision: number) {
    this.signal.throwIfAborted();
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
  async publish(
    config: McpConfig,
    storeRevision: number,
    value: string,
    registrationRef?: string,
    cancellation = this.signal,
  ) {
    assert(
      config.transport.type === 'streamable-http',
      'MCP_AUTH_UNSUPPORTED',
      '请选择固定的 HTTP 服务器。',
    );
    const signal = AbortSignal.any([cancellation, this.signal]);
    // Keep the old reference until deletion succeeds. A failed rotation remains retryable.
    if (config.transport.auth.type !== 'none') {
      const disabled = await this.configs.disable(config.id, storeRevision);
      await this.stopRefreshes(config.id);
      await this.remove(config);
      config = { ...config, revision: config.revision + 1, enabled: false };
      storeRevision = disabled.revision;
    }
    assert(
      config.transport.type === 'streamable-http',
      'MCP_AUTH_UNSUPPORTED',
      '请选择固定的 HTTP 服务器。',
    );
    signal.throwIfAborted();
    const id = randomUUID(),
      key = this.key(config, id);
    const storage = await this.secrets.put(key, value, signal);
    let published = false;
    try {
      signal.throwIfAborted();
      const credentialRef = `${storage}:${config.revision + 1}:${id}`;
      const auth = registrationRef
        ? { type: 'oauth' as const, credentialRef, registrationRef }
        : { type: 'bearer' as const, credentialRef };
      const result = await this.configs.upsert(
        { ...config, transport: { ...config.transport, auth } },
        storeRevision,
        config.revision,
      );
      published = true;
      return result;
    } finally {
      if (!published) await this.secrets.delete(key, storage);
    }
  }
  async remove(config: McpConfig) {
    if (config.transport.type !== 'streamable-http' || config.transport.auth.type === 'none')
      return;
    const ref = credentialReference(config);
    await this.secrets.delete(this.key(config, ref.id), ref.storage);
  }
}
