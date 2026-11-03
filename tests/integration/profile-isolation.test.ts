import { serve } from '@hono/node-server';
import { startHost } from '@praxis/client-host';
import { profilePaths } from '@praxis/config/profile';
import { SessionStore } from '@praxis/storage-local';
import { acquireLease } from '@praxis/workspace';
import { createApp } from '@praxis/server/app';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { chatFixture } from './chat-fixture.ts';

test('the same user ID from different Praxis origins never shares local sessions', async () => {
  const f = await chatFixture(),
    root = await mkdtemp(path.join(tmpdir(), 'praxis-origins-'));
  const servers = [await startServer(f), await startServer(f)];
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  try {
    const key = await f.auth.createApiKey(
      f.identity,
      'origins',
      ['profile:read', 'providers:read', 'client:direct'],
      1,
    );
    for (const [round, index] of [0, 1, 0].entries()) {
      const server = servers[index];
      assert(server);
      host = await startHost('cli', { PRAXIS_DATA_DIR: path.join(root, 'data') });
      await host.rpc.request('auth/bind', { serverUrl: server.url, praxisApiKey: key.key });
      const sessions = await host.rpc.request<unknown[]>('session/list');
      if (round === 0) {
        assert.equal(sessions.length, 0);
        const workspace = await host.rpc.request<{ id: string }>('workspace/open', { path: root });
        await host.rpc.request('session/create', { kind: 'agent', workspaceId: workspace.id });
      } else assert.equal(sessions.length, index === 0 ? 1 : 0);
      await host.close();
      host = undefined;
    }
  } finally {
    await host?.close();
    for (const { server } of servers) {
      server.close();
      if ('closeAllConnections' in server) server.closeAllConnections();
    }
    await f.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI legacy binding preserves old history, rejects an active writer and requires the original origin', async () => {
  const f = await chatFixture(),
    root = await mkdtemp(path.join(tmpdir(), 'praxis-legacy-cli-'));
  const { server, url } = await startServer(f);
  try {
    const key = await f.auth.createApiKey(
      f.identity,
      'legacy',
      ['profile:read', 'providers:read', 'client:direct'],
      1,
    );
    const identity = { userId: f.identity.userId, clientKind: 'cli' as const, serverUrl: url };
    const data = path.join(root, 'data'),
      legacy = profilePaths(data, identity).legacy;
    const store = new SessionStore(path.join(legacy, 'sessions.sqlite'));
    const session = store.create(f.identity.userId, 'agent', root);
    store.close();
    const cli = (...args: string[]) =>
      promisify(execFile)(process.execPath, ['--import', 'tsx', 'apps/cli/src/main.ts', ...args], {
        env: {
          ...process.env,
          PRAXIS_DATA_DIR: data,
          PRAXIS_SERVER_URL: url,
          PRAXIS_API_KEY: key.key,
        },
        timeout: 15000,
      });
    await assert.rejects(cli('sessions'), /PROFILE_BINDING_REQUIRED/);
    await assert.rejects(cli('data', 'bind-legacy'), /PROFILE_CONFIRM_REQUIRED/);
    await assert.rejects(
      cli('data', 'bind-legacy', '--confirm', 'https://other.example'),
      /PROFILE_CONFIRM_REQUIRED/,
    );
    const lease = await acquireLease(path.join(legacy, 'writer.lock'));
    try {
      await assert.rejects(cli('data', 'bind-legacy', '--confirm', url), /WORKSPACE_BUSY/);
    } finally {
      await lease.release();
    }
    await cli('data', 'bind-legacy', '--confirm', url);
    const sessions = JSON.parse((await cli('sessions')).stdout);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, session.id);
    await cli('data', 'backup', root);
  } finally {
    server.close();
    if ('closeAllConnections' in server) server.closeAllConnections();
    await f.close();
    await rm(root, { recursive: true, force: true });
  }
});

async function startServer(f: Awaited<ReturnType<typeof chatFixture>>) {
  const server = serve({
    fetch: createApp(f.auth, f.runtime, 'http://127.0.0.1:4310').fetch,
    hostname: '127.0.0.1',
    port: 0,
  });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  return { server, url: `http://127.0.0.1:${address.port}` };
}
