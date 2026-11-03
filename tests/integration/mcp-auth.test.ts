import { serve } from '@hono/node-server';
import { startHost } from '@praxis/client-host';
import { createApp } from '@praxis/server/app';
import { uuid } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { chatFixture } from './chat-fixture.ts';
import { provider } from './fixture.ts';
import { installProvider } from './prompt-provider.ts';
import { mcpHttpFixture } from '../fixtures/mcp-http.ts';
const execute = promisify(execFile);

test('CLI consumes a one-time Bearer input, reports memory fallback, and enables it for a foreground run', async () => {
  const f = await chatFixture(),
    remote = await mcpHttpFixture();
  const root = await mkdtemp(path.join(os.tmpdir(), 'praxis-cli-mcp-auth-'));
  const server = serve({
    fetch: createApp(f.auth, f.runtime, 'http://127.0.0.1:4310').fetch,
    hostname: '127.0.0.1',
    port: 0,
  });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  try {
    const native = path.join(root, 'native'),
      workspace = path.join(root, 'workspace');
    await mkdir(native);
    await mkdir(workspace);
    const lease = `praxis-lease${process.platform === 'win32' ? '.exe' : ''}`;
    await copyFile(path.resolve('build/native', lease), path.join(native, lease));
    // No credential helper: use the documented fallback without touching a real keychain.
    await f.auth.saveProvider(
      f.identity,
      { ...provider, adapter: 'fixture.prompt/model' },
      'fixture-plugin-key',
      f.config.id,
      1,
    );
    const key = await f.auth.createApiKey(
      f.identity,
      'fixture',
      ['profile:read', 'providers:read', 'client:direct'],
      1,
    );
    const env = {
      PRAXIS_DATA_DIR: path.join(root, 'data'),
      PRAXIS_NATIVE_DIR: native,
      PRAXIS_SECRET_STORE: 'memory',
      PRAXIS_SERVER_URL: `http://127.0.0.1:${address.port}`,
      PRAXIS_API_KEY: key.key,
    };
    host = await startHost('cli', env);
    await host.rpc.request('auth/bind', {
      serverUrl: env.PRAXIS_SERVER_URL,
      praxisApiKey: key.key,
    });
    await installProvider(host, root);
    const serverId = uuid();
    await host.rpc.request('mcp/server-upsert', {
      config: {
        id: serverId,
        namespace: 'fixture',
        displayName: 'Fixture',
        revision: 1,
        enabled: false,
        protocol: 'auto',
        transport: {
          type: 'streamable-http',
          endpoint: remote.endpoint,
          allowPrivateDestination: true,
          auth: { type: 'none' },
        },
        capabilities: { tools: true, resources: false, prompts: false },
      },
      expectedStoreRevision: 0,
      expectedRevision: null,
    });
    await host.close();
    host = undefined;
    const token = 'fake-cli-mcp-token';
    const options = {
      env: { ...process.env, ...env, PRAXIS_MCP_BEARER: token },
      timeout: 20000,
      maxBuffer: 1024 * 1024,
    };
    const auth = await execute(
      process.execPath,
      ['--import', 'tsx', 'apps/cli/src/main.ts', 'mcp', 'auth', serverId],
      options,
    );
    assert.match(auth.stdout, /"storage": "memory"/);
    assert.ok(!auth.stdout.includes(token));
    const applied = await execute(
      process.execPath,
      [
        '--import',
        'tsx',
        'apps/cli/src/main.ts',
        'run',
        '--workspace',
        workspace,
        '--provider',
        f.config.id,
        '--prompt',
        '外部模板 Create a hello page',
        '--mcp-bearer-server',
        serverId,
      ],
      options,
    );
    assert.match(applied.stdout, /completed/);
    assert.ok(!applied.stdout.includes(token));
    assert.ok(
      remote.requests.length > 0 &&
        remote.requests.every((r) => r.headers.authorization === `Bearer ${token}`),
    );
    const listed = await execute(
      process.execPath,
      ['--import', 'tsx', 'apps/cli/src/main.ts', 'mcp', 'list'],
      options,
    );
    assert.match(listed.stdout, /"storage": "missing"/);
    assert.ok(!listed.stdout.includes(token));
    const removed = await execute(
      process.execPath,
      ['--import', 'tsx', 'apps/cli/src/main.ts', 'mcp', 'remove', serverId],
      options,
    );
    assert.equal(JSON.parse(removed.stdout).value.length, 0);
  } finally {
    await host?.close();
    server.close();
    if ('closeAllConnections' in server) server.closeAllConnections();
    await remote.close();
    await f.close();
    await rm(root, { recursive: true, force: true });
  }
});
