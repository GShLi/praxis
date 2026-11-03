import { serve } from '@hono/node-server';
import { startHost } from '@praxis/client-host';
import { createApp } from '@praxis/server/app';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { chatFixture } from './chat-fixture.ts';
import { checkDiagnosticExport } from './diagnostic-assertions.ts';
const execute = promisify(execFile);

test('offline CLI backup verifies identity and writer lease, requires exact confirmation and restores a closed profile', async () => {
  const f = await chatFixture(),
    root = await mkdtemp(path.join(tmpdir(), 'praxis-cli-backup-'));
  const server = serve({
    fetch: createApp(f.auth, f.runtime, 'http://127.0.0.1:4310').fetch,
    hostname: '127.0.0.1',
    port: 0,
  });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  try {
    const key = await f.auth.createApiKey(
      f.identity,
      'backup',
      ['profile:read', 'providers:read', 'client:direct'],
      1,
    );
    const env = {
      PRAXIS_DATA_DIR: path.join(root, 'data'),
      PRAXIS_SERVER_URL: `http://127.0.0.1:${address.port}`,
      PRAXIS_API_KEY: key.key,
    };
    const cli = (...args: string[]) =>
      execute(process.execPath, ['--import', 'tsx', 'apps/cli/src/main.ts', ...args], {
        env: { ...process.env, ...env },
        timeout: 15000,
      });
    const bind = async () => {
      const current = await startHost('cli', env);
      await current.rpc.request('auth/bind', {
        serverUrl: env.PRAXIS_SERVER_URL,
        praxisApiKey: key.key,
      });
      return current;
    };
    host = await bind();
    const workspace = await host.rpc.request<{ id: string }>('workspace/open', { path: root });
    await host.rpc.request('session/create', { kind: 'agent', workspaceId: workspace.id });
    await checkDiagnosticExport(root, env, host);
    await assert.rejects(cli('data', 'backup', root), /WORKSPACE_BUSY/);
    await host.close();
    host = undefined;
    const saved = JSON.parse((await cli('data', 'backup', root)).stdout) as {
      directory: string;
      manifest: { sha256: string };
    };
    const inspected = JSON.parse((await cli('data', 'inspect', saved.directory)).stdout);
    assert.equal(inspected.counts.sessions, 1);
    assert.ok(!JSON.stringify(inspected).includes(key.key));
    host = await bind();
    const anotherWorkspace = await host.rpc.request<{ id: string }>('workspace/open', {
      path: root,
    });
    await host.rpc.request('session/create', { kind: 'agent', workspaceId: anotherWorkspace.id });
    await host.close();
    host = undefined;
    await assert.rejects(cli('data', 'restore', saved.directory), /BACKUP_CONFIRM_REQUIRED/);
    await assert.rejects(
      cli('data', 'restore', saved.directory, '--confirm', '0'.repeat(64)),
      /BACKUP_CHANGED/,
    );
    assert.equal(JSON.parse((await cli('sessions')).stdout).length, 2);
    const restored = await cli(
      'data',
      'restore',
      saved.directory,
      '--confirm',
      saved.manifest.sha256,
    );
    assert.match(restored.stdout, /rollbackDirectory/);
    assert.equal(JSON.parse((await cli('sessions')).stdout).length, 1);
  } finally {
    await host?.close();
    server.close();
    if ('closeAllConnections' in server) server.closeAllConnections();
    await f.close();
    await rm(root, { recursive: true, force: true });
  }
});
