import { installProvider } from './prompt-provider.ts';
import { serve } from '@hono/node-server';
import { startHost } from '@praxis/client-host';
import { createApp } from '@praxis/server/app';
import { uuid } from '@praxis/storage-local';
import { mcpPromptPreviewSchema } from '@praxis/contracts';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { chatFixture } from './chat-fixture.ts';
import { provider } from './fixture.ts';
import { mcpHttpFixture } from '../fixtures/mcp-http.ts';
const execute = promisify(execFile);

test('real CLI previews a remote prompt, restarts and applies its exact snapshot through an installed model adapter', async () => {
  const f = await chatFixture();
  const remote = await mcpHttpFixture(false, false, true);
  const root = await mkdtemp(path.join(os.tmpdir(), 'praxis-cli-prompts-'));
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
      PRAXIS_SERVER_URL: `http://127.0.0.1:${address.port}`,
      PRAXIS_API_KEY: key.key,
    };
    host = await startHost('cli', env);
    await host.rpc.request('auth/bind', {
      serverUrl: env.PRAXIS_SERVER_URL,
      praxisApiKey: key.key,
    });
    await installProvider(host, root);
    const workspace = path.join(root, 'workspace');
    await mkdir(workspace);
    const opened = await host.rpc.request<{ id: string }>('workspace/open', { path: workspace });
    const session = await host.rpc.request<{ id: string }>('session/create', {
      kind: 'agent',
      workspaceId: opened.id,
    });
    const serverId = uuid();
    await host.rpc.request('mcp/server-upsert', {
      config: {
        id: serverId,
        namespace: 'prompts',
        displayName: 'Prompts',
        revision: 1,
        enabled: false,
        protocol: 'auto',
        transport: {
          type: 'streamable-http',
          endpoint: remote.endpoint,
          allowPrivateDestination: true,
          auth: { type: 'none' },
        },
        capabilities: { tools: false, resources: false, prompts: true },
      },
      expectedStoreRevision: 0,
      expectedRevision: null,
    });
    await host.rpc.request('mcp/test', { serverId, expectedRevision: 1 });
    await host.rpc.request('mcp/server-enable', {
      serverId,
      expectedRevision: 1,
      expectedStoreRevision: 1,
    });
    await host.close();
    host = undefined;
    const options = { env: { ...process.env, ...env }, timeout: 20000, maxBuffer: 1024 * 1024 };
    const previewProcess = await execute(
      process.execPath,
      [
        '--import',
        'tsx',
        'apps/cli/src/main.ts',
        'mcp',
        'preview',
        session.id,
        serverId,
        'page',
        '--arguments',
        '{"topic":"Hello World"}',
      ],
      options,
    );
    const preview = mcpPromptPreviewSchema.parse(JSON.parse(previewProcess.stdout));
    assert.equal(remote.requests.filter((r) => r.method === 'prompts/get').length, 1);
    const applied = await execute(
      process.execPath,
      [
        '--import',
        'tsx',
        'apps/cli/src/main.ts',
        'run',
        '--resume',
        session.id,
        '--provider',
        f.config.id,
        '--apply-prompt',
        preview.previewId,
        '--content-hash',
        preview.contentHash,
      ],
      options,
    );
    assert.match(applied.stdout, /Template applied/);
    assert.match(applied.stdout, /completed/);
    assert.ok(!applied.stdout.includes(key.key));
    assert.equal(remote.requests.filter((r) => r.method === 'prompts/get').length, 1);
  } finally {
    await host?.close();
    server.close();
    if ('closeAllConnections' in server) server.closeAllConnections();
    await remote.close();
    await f.close();
    await rm(root, { recursive: true, force: true });
  }
});
