import { serve } from '@hono/node-server';
import { createApp } from '@praxis/server/app';
import { startHost } from '@praxis/client-host';
import { UserInstructionRepository } from '@praxis/storage-server';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { chatFixture } from './chat-fixture.ts';
const execute = promisify(execFile);

test('CLI edits personal instructions with an explicit revision and keeps desktop and Web settings separate', async () => {
  const f = await chatFixture(),
    root = await mkdtemp(path.join(tmpdir(), 'praxis-cli-instructions-'));
  const server = serve({
    fetch: createApp(f.auth, f.runtime, 'http://127.0.0.1:4310').fetch,
    hostname: '127.0.0.1',
    port: 0,
  });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  let desktop: Awaited<ReturnType<typeof startHost>> | undefined;
  try {
    const key = await f.auth.createApiKey(f.identity, 'instructions', ['profile:read'], 1);
    const env = {
      PRAXIS_DATA_DIR: path.join(root, 'data'),
      PRAXIS_SERVER_URL: `http://127.0.0.1:${address.port}`,
      PRAXIS_API_KEY: key.key,
    };
    const cli = (...args: string[]) =>
      execute(
        process.execPath,
        ['--import', 'tsx', 'apps/cli/src/main.ts', 'instructions', ...args],
        { env: { ...process.env, ...env }, timeout: 15000 },
      );
    assert.equal(JSON.parse((await cli('show')).stdout).revision, 0);
    const file = path.join(root, 'preferences.txt');
    await writeFile(file, '请用中文解释代码。');
    assert.equal(JSON.parse((await cli('set', file, '--revision', '0')).stdout).revision, 1);
    await assert.rejects(cli('set', file, '--revision', '0'), /CONFIG_CONFLICT/);
    await assert.rejects(cli('disable'), /CONFIG_REVISION_REQUIRED/);
    const shown = JSON.parse((await cli('show')).stdout);
    assert.equal(shown.value.text, '请用中文解释代码。');
    assert.equal(JSON.parse((await cli('disable', '--revision', '1')).stdout).revision, 2);
    assert.equal(JSON.parse((await cli('show')).stdout).value.enabled, false);
    desktop = await startHost('desktop', env);
    await desktop.rpc.request('auth/bind', {
      serverUrl: env.PRAXIS_SERVER_URL,
      praxisApiKey: key.key,
    });
    assert.equal(
      (await desktop.rpc.request<{ revision: number }>('user-instructions/read')).revision,
      0,
    );
    assert.equal(
      (await new UserInstructionRepository(f.database).read(f.identity.userId)).revision,
      0,
    );
  } finally {
    await desktop?.close();
    server.close();
    if ('closeAllConnections' in server) server.closeAllConnections();
    await f.close();
    await rm(root, { recursive: true, force: true });
  }
});
