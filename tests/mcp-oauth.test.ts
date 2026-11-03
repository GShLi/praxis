import { McpCredentials, SecretStore } from '@praxis/mcp-client/credentials';
import { McpConfigService, type McpConfig } from '@praxis/mcp-core';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { oauthFixture, unusedCallback } from './fixtures/oauth-server.ts';

test('OAuth binds PKCE/resource, rejects false state, stores only references and single-flights refresh', async () => {
  const remote = await oauthFixture();
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-oauth-'));
  const values = new Map<string, string>();
  const configs = new McpConfigService(root, () => {});
  const credentials = new McpCredentials(
    configs,
    new SecretStore({
      set: async (k, v) => {
        values.set(k, v);
      },
      get: async (k) => values.get(k),
      delete: async (k) => {
        values.delete(k);
      },
    }),
    'alice',
    'cli',
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
  try {
    await configs.upsert(config, 0, null);
    const redirectUri = await unusedCallback();
    remote.state.accessLifetime = 1;
    const started = await credentials.oauth.start({
      serverId: config.id,
      expectedStoreRevision: 1,
      expectedRevision: 1,
      issuer: remote.origin,
      clientId: 'praxis-public-fixture',
      redirectUri,
      scopes: ['docs:read'],
      allowPrivateIssuer: true,
    });
    const url = new URL(started.authorizationUrl);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    const wrong = new URL(redirectUri);
    wrong.searchParams.set('state', 'incorrect');
    wrong.searchParams.set('code', 'fake-code');
    assert.equal((await fetch(wrong)).status, 400);
    assert.equal(credentials.oauth.status(started.id).status, 'waiting');
    wrong.searchParams.set('state', url.searchParams.get('state')!);
    assert.equal((await fetch(wrong)).status, 200);
    const finished = await credentials.oauth.wait(started.id);
    assert.equal(finished.status, 'succeeded');
    remote.verifyPkce(url);
    const saved = (await configs.file.read()).value[0]!;
    assert.ok(!(await readFile(configs.file.file, 'utf8')).includes('fixture-access'));
    remote.state.accessLifetime = 3600;
    const results = await Promise.all(
      Array.from({ length: 4 }, () => credentials.resolve(saved, AbortSignal.timeout(5000))),
    );
    assert.ok(results.every((r) => r.bearer === 'fixture-access-1'));
    assert.equal(remote.refreshes(), 1);
    await credentials.clear(config.id, 2, saved.revision);
    assert.equal(values.size, 0);
    await assert.rejects(fetch(wrong));
  } finally {
    await credentials.close();
    await remote.close();
    await rm(root, { recursive: true, force: true });
  }
});
