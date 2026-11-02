import { McpMaintenance } from '@praxis/mcp-client/maintenance';
import { McpRuntime } from '@praxis/mcp-client/runtime';
import { McpConfigService, type McpConfig } from '@praxis/mcp-core';
import { SessionStore, uuid } from '@praxis/storage-local';
import { mkdtemp, rm } from 'node:fs/promises';
import { mcpHttpFixture } from './mcp-http.ts';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function mcpFixture(legacy = false, resources = false) {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-mcp-business-'));
  const store = new SessionStore(':memory:');
  const http = await mcpHttpFixture(legacy, resources);
  const { requests, remote } = http;
  const config: McpConfig = {
    id: uuid(),
    namespace: 'echo',
    displayName: 'Local fixture',
    revision: 1,
    enabled: false,
    protocol: legacy ? '2025-11-25' : 'auto',
    transport: {
      type: 'streamable-http',
      endpoint: http.endpoint,
      allowPrivateDestination: true,
      auth: { type: 'none' },
    },
    capabilities: { tools: true, resources, prompts: false },
  };
  const configs = new McpConfigService(root, (id) => {
    maintenance.cancel(id);
    mcp.invalidate(id);
  });
  const maintenance = new McpMaintenance(configs, store, 'alice', 'cli');
  const mcp = new McpRuntime(configs, store, 'cli');
  const session = store.create('alice', 'agent', root);
  await configs.upsert(config, 0, null);
  return {
    root,
    store,
    config,
    configs,
    maintenance,
    mcp,
    session,
    requests,
    remote,
    async enable() {
      const state = await configs.file.read();
      const current = state.value[0]!;
      await maintenance.test(config.id, current.revision);
      await maintenance.enable(config.id, state.revision, current.revision);
    },
    async close() {
      await maintenance.close();
      await mcp.close();
      store.close();
      await http.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
