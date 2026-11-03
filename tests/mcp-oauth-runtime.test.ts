import { McpCredentials, SecretStore } from '@praxis/mcp-client/credentials';
import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { mcpFixture } from './fixtures/mcp-server.ts';
import { oauthFixture, unusedCallback } from './fixtures/oauth-server.ts';

test('OAuth refresh revokes an already bound MCP operation and does not require a config edit', async () => {
  let credentials: McpCredentials | undefined;
  const f = await mcpFixture(false, false, true, undefined, (config, signal) => {
    assert(credentials);
    return credentials.resolve(config, signal);
  });
  const oauth = await oauthFixture(),
    values = new Map<string, string>();
  credentials = new McpCredentials(
    f.configs,
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
    [],
    (id, epoch) => {
      f.maintenance.invalidateAuthentication(id);
      f.mcp.invalidateAuthentication(id, epoch);
    },
  );
  try {
    f.remote.oauthIssuer = oauth.origin;
    oauth.state.accessLifetime = 31;
    const callback = new URL(await unusedCallback());
    const flow = await credentials.oauth.start({
      serverId: f.config.id,
      expectedStoreRevision: 1,
      expectedRevision: 1,
      issuer: oauth.origin,
      clientId: 'praxis-public-fixture',
      redirectUri: callback.href,
      scopes: ['docs:read'],
      allowPrivateIssuer: true,
    });
    callback.searchParams.set('code', 'fixture-code');
    callback.searchParams.set('state', new URL(flow.authorizationUrl).searchParams.get('state')!);
    await fetch(callback);
    assert.equal((await credentials.oauth.wait(flow.id)).status, 'succeeded');
    await f.enable();
    let arrived = () => {};
    const ready = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const stopped = assert.rejects(
      f.mcp.userOperation(f.session, (scope) =>
        scope.run(
          f.config.id,
          'fixture',
          'mcp.list_prompts',
          {},
          async ({ connection, signal }) => {
            await connection.catalog();
            arrived();
            await new Promise<void>((_resolve, reject) =>
              signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
            );
          },
          { capability: 'prompts', metadataOnly: true },
        ),
      ),
      { code: 'MCP_CONFIG_CHANGED' },
    );
    await ready;
    oauth.state.accessLifetime = 3600;
    await delay(1100);
    const saved = await f.configs.file.read();
    const result = await credentials.resolve(saved.value[0]!, AbortSignal.timeout(3000));
    assert.equal(result.bearer, 'fixture-access-1');
    await stopped;
    assert.equal((await f.configs.file.read()).revision, saved.revision);
    assert.equal(oauth.refreshes(), 1);
    assert.ok(!JSON.stringify(f.store.events(f.session.id)).includes('fixture-access'));
  } finally {
    await f.mcp.close();
    await credentials.close();
    await oauth.close();
    await f.close();
  }
});
