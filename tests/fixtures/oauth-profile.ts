import { McpCredentials, SecretStore, type SecretBackend } from '@praxis/mcp-client/credentials';
import { McpConfigService, type McpConfig } from '@praxis/mcp-core';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { oauthFixture, unusedCallback } from './oauth-server.ts';

export async function oauthProfile() {
  const remote = await oauthFixture(),
    root = await mkdtemp(path.join(tmpdir(), 'praxis-oauth-'));
  const values = new Map<string, string>();
  const backend: SecretBackend = {
    set: async (k, v) => {
      values.set(k, v);
    },
    get: async (k) => values.get(k),
    delete: async (k) => {
      values.delete(k);
    },
  };
  let credentials: McpCredentials;
  const configs = new McpConfigService(root, (id) => credentials.oauth.invalidate(id));
  const epochs: number[] = [];
  credentials = new McpCredentials(
    configs,
    new SecretStore(backend),
    'alice',
    'cli',
    ['fixture-praxis-key'],
    (_id, epoch) => epochs.push(epoch),
  );
  const config: McpConfig = {
    id: randomUUID(),
    namespace: 'docs',
    displayName: 'Docs',
    revision: 1,
    enabled: false,
    protocol: 'auto',
    capabilities: { tools: true, resources: false, prompts: false },
    transport: {
      type: 'streamable-http',
      endpoint: `${remote.origin}/mcp`,
      allowPrivateDestination: true,
      auth: { type: 'none' },
    },
  };
  await configs.upsert(config, 0, null);
  const input = {
    serverId: config.id,
    expectedStoreRevision: 1,
    expectedRevision: 1,
    issuer: remote.origin,
    clientId: 'praxis-public-fixture',
    redirectUri: await unusedCallback(),
    scopes: ['docs:read'],
    allowPrivateIssuer: true,
  };
  return {
    remote,
    root,
    values,
    backend,
    configs,
    credentials,
    config,
    input,
    epochs,
    async authorize(extra: Record<string, string> = {}) {
      const started = await credentials.oauth.start(input);
      const url = new URL(started.authorizationUrl),
        callback = new URL(input.redirectUri);
      callback.searchParams.set('state', url.searchParams.get('state')!);
      callback.searchParams.set('code', 'fake-code');
      for (const [key, value] of Object.entries(extra)) callback.searchParams.set(key, value);
      await fetch(callback);
      return credentials.oauth.wait(started.id);
    },
    async close() {
      await credentials.close();
      await remote.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
