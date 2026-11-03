import { serve } from '@hono/node-server';
import { startHost } from '@praxis/client-host';
import { createApp } from '@praxis/server/app';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { chatFixture } from './chat-fixture.ts';
const execute = promisify(execFile);

async function commandPackage(root: string) {
  const source = path.join(root, 'plugin');
  await mkdir(source);
  await writeFile(
    path.join(source, 'praxis-plugin.json'),
    JSON.stringify({
      id: 'fixture.cli',
      version: '1.0.0',
      sdkVersion: '^1.0.0',
      entry: 'plugin.mjs',
      runtimes: ['local-host'],
      modes: ['agent'],
      capabilities: ['user-command'],
      platforms: ['darwin', 'linux', 'win32'],
    }),
  );
  await writeFile(
    path.join(source, 'plugin.mjs'),
    `export default {activate(ctx){ctx.registerCommand('hello',async (_args, services)=>{
    const value=await services.invokeCore('fs_write',{path:'hello.html',mode:'create',content:'<h1>Hello World！！！</h1>'});
    if(value.status!=='succeeded') throw Error('write failed'); return value;
  },{type:'object',properties:{},additionalProperties:false});}}`,
  );
  return source;
}

test('CLI authenticates over HTTP, reloads an installed command and creates a real file without model configuration', async () => {
  const f = await chatFixture({
    async complete() {
      throw new Error('No model calls allowed');
    },
  });
  await f.auth.deleteProvider(f.identity, f.config.id, 1);
  const root = await mkdtemp(path.join(os.tmpdir(), 'praxis-cli-command-'));
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
    const key = await f.auth.createApiKey(f.identity, 'fixture-cli', ['profile:read'], 1);
    const env = {
      PRAXIS_DATA_DIR: path.join(root, 'data'),
      PRAXIS_SERVER_URL: `http://127.0.0.1:${address.port}`,
      PRAXIS_API_KEY: key.key,
    };
    host = await startHost('cli', env);
    await host.rpc.request('auth/bind', {
      serverUrl: env.PRAXIS_SERVER_URL,
      praxisApiKey: key.key,
    });
    const source = await commandPackage(root);
    const inspected = await host.rpc.request<{ digest: string }>('plugin/inspect', { source });
    await host.rpc.request('plugin/install', {
      source,
      expectedDigest: inspected.digest,
      expectedRevision: 0,
    });
    await host.rpc.request('plugin/set-enabled', {
      id: 'fixture.cli',
      enabled: true,
      expectedRevision: 1,
    });
    await host.close();
    host = undefined;
    const workspace = path.join(root, 'workspace');
    await mkdir(workspace);
    const result = await execute(
      process.execPath,
      [
        '--import',
        'tsx',
        'apps/cli/src/main.ts',
        'run',
        '--workspace',
        workspace,
        '--command',
        'fixture.cli/hello',
      ],
      { env: { ...process.env, ...env }, timeout: 20000, maxBuffer: 1024 * 1024 },
    );
    assert.equal(
      await readFile(path.join(workspace, 'hello.html'), 'utf8'),
      '<h1>Hello World！！！</h1>',
    );
    assert.match(result.stdout, /completed/);
    assert.ok(!result.stdout.includes(key.key));
  } finally {
    await host?.close();
    server.close();
    if ('closeAllConnections' in server) server.closeAllConnections();
    await f.close();
    await rm(root, { recursive: true, force: true });
  }
});
