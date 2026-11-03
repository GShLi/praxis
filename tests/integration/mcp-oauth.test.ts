import { serve } from '@hono/node-server';
import { startHost } from '@praxis/client-host';
import { createApp } from '@praxis/server/app';
import { uuid } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { chatFixture } from './chat-fixture.ts';
import { provider } from './fixture.ts';
import { installProvider } from './prompt-provider.ts';
import { mcpHttpFixture } from '../fixtures/mcp-http.ts';
import { oauthFixture, unusedCallback } from '../fixtures/oauth-server.ts';

test('CLI authorizes OAuth through a loopback callback, uses the token in a foreground run and forgets memory credentials on exit', async () => {
  const f = await chatFixture(),
    remote = await mcpHttpFixture(),
    oauth = await oauthFixture();
  const root = await mkdtemp(path.join(os.tmpdir(), 'praxis-cli-oauth-'));
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
    const workspace = path.join(root, 'workspace');
    await mkdir(workspace);
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
    remote.remote.oauthIssuer = oauth.origin;
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
    const callback = await unusedCallback();
    const stdout = await runAuthorizedCli(
      [
        'run',
        '--workspace',
        workspace,
        '--provider',
        f.config.id,
        '--prompt',
        '外部模板 Create a hello page',
        '--mcp-oauth-server',
        serverId,
        '--issuer',
        oauth.origin,
        '--client-id',
        'praxis-public-fixture',
        '--redirect-uri',
        callback,
        '--scopes',
        'docs:read',
        '--allow-private-issuer',
        '--no-browser',
      ],
      env,
    );
    assert.match(stdout, /completed/);
    assert.ok(!stdout.includes('fixture-access') && !stdout.includes('fixture-refresh'));
    assert.equal(oauth.grants.length, 1);
    assert.equal(oauth.grants[0]?.get('resource'), remote.endpoint);
    assert.ok(
      remote.requests.length > 0 &&
        remote.requests.every((r) => r.headers.authorization === 'Bearer fixture-access-0'),
    );
    const listed = await promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', 'apps/cli/src/main.ts', 'mcp', 'list'],
      { env: { ...process.env, ...env }, timeout: 15000 },
    );
    assert.match(listed.stdout, /"storage": "missing"/);
    await assert.rejects(fetch(callback));
  } finally {
    await host?.close();
    server.close();
    if ('closeAllConnections' in server) server.closeAllConnections();
    await remote.close();
    await oauth.close();
    await f.close();
    await rm(root, { recursive: true, force: true });
  }
});

async function runAuthorizedCli(args: string[], env: Record<string, string>) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/cli/src/main.ts', ...args], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 25000,
  });
  let stdout = '',
    stderr = '',
    reply: Promise<void> | undefined;
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
    const match = stdout.match(/http:\/\/127\.0\.0\.1:\d+\/authorize\?[^\r\n]+\n/);
    if (!match || reply) return;
    const url = new URL(match[0].trim()),
      callback = new URL(url.searchParams.get('redirect_uri')!);
    callback.searchParams.set('state', url.searchParams.get('state')!);
    callback.searchParams.set('code', 'fixture-cli-code');
    reply = fetch(callback).then((response) => {
      assert.equal(response.status, 200);
    });
    reply.catch(() => child.kill('SIGTERM'));
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  await reply;
  assert.equal(code, 0, stderr);
  assert(reply);
  return stdout;
}
