import { assert } from '@praxis/contracts';
import { validateConfig, type McpConfig } from '@praxis/mcp-core';
import type { CredentialRecords } from './records.ts';

/** Changing an endpoint must not strand the old OS item or inherit another endpoint's consent. */
export class CredentialConfigChanges {
  constructor(
    private records: CredentialRecords,
    private stopServer: (id: string) => Promise<void>,
  ) {}
  private async current(id: string, storeRevision: number, revision: number | null) {
    this.records.signal.throwIfAborted();
    const state = await this.records.configs.file.read(),
      old = state.value.find((c) => c.id === id);
    assert(
      state.revision === storeRevision && (old ? old.revision === revision : revision === null),
      'CONFIG_CONFLICT',
      '服务器版本已变化，请刷新后重试。',
    );
    return { old, state };
  }
  async save(raw: unknown, storeRevision: number, revision: number | null) {
    const config = validateConfig(raw),
      { old, state } = await this.current(config.id, storeRevision, revision);
    assert(
      !old || old.namespace === config.namespace,
      'CONFIG_CONFLICT',
      '已有服务器的命名空间不能修改。',
    );
    assert(
      !state.value.some((c) => c.id !== config.id && c.namespace === config.namespace),
      'MCP_NAMESPACE_CONFLICT',
      'MCP 命名空间已被占用。',
    );
    const sameEndpoint =
      config.transport.type === 'streamable-http' &&
      old?.transport.type === 'streamable-http' &&
      new URL(config.transport.endpoint).href === new URL(old.transport.endpoint).href;
    const next =
      config.transport.type === 'streamable-http'
        ? {
            ...config,
            transport: {
              ...config.transport,
              auth:
                sameEndpoint && old?.transport.type === 'streamable-http'
                  ? old.transport.auth
                  : { type: 'none' as const },
            },
          }
        : config;
    if (
      old &&
      !sameEndpoint &&
      old.transport.type === 'streamable-http' &&
      old.transport.auth.type !== 'none'
    ) {
      const disabled = await this.disableAndClean(old, storeRevision);
      return this.records.configs.upsert(next, disabled.revision, old.revision + 1);
    }
    return this.records.configs.upsert(next, storeRevision, revision);
  }
  async remove(serverId: string, storeRevision: number, revision: number) {
    const { old } = await this.current(serverId, storeRevision, revision);
    assert(old, 'MCP_NOT_FOUND', '服务器不存在。');
    const disabled = await this.disableAndClean(old, storeRevision);
    return this.records.configs.remove(serverId, disabled.revision, old.revision + 1);
  }
  async clear(serverId: string, storeRevision: number, revision: number) {
    const config = await this.records.checked(serverId, storeRevision, revision);
    const disabled = await this.disableAndClean(config, storeRevision);
    return this.records.configs.upsert(
      { ...config, transport: { ...config.transport, auth: { type: 'none' } } },
      disabled.revision,
      config.revision + 1,
    );
  }
  private async disableAndClean(config: McpConfig, storeRevision: number) {
    const disabled = await this.records.configs.disable(config.id, storeRevision);
    await this.stopServer(config.id);
    // On failure the disabled config still contains the reference, so deletion can be retried.
    await this.records.remove(config);
    this.records.signal.throwIfAborted();
    return disabled;
  }
}
