import { serve } from '@hono/node-server';
import { createApp } from '@praxis/server/app';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { localCluster } from '../../scripts/postgres/cluster.ts';
import { chatFixture } from '../integration/chat-fixture.ts';
import { provider } from '../integration/fixture.ts';
import { setupDesktop } from './desktop-setup.ts';

async function main() {
  const bin = process.env.PRAXIS_TEST_PG_BIN;
  if (!bin) throw new Error('PRAXIS_TEST_PG_BIN is required for an isolated desktop fixture.');
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-desktop-acceptance-'));
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const deadline = setTimeout(stop, 3_600_000);
  let cluster: Awaited<ReturnType<typeof localCluster>> | undefined;
  let fixture: Awaited<ReturnType<typeof chatFixture>> | undefined;
  let server: ReturnType<typeof serve> | undefined;
  try {
    // Keep the database available while closing runtimes and dropping the fixture database.
    cluster = await localCluster(path.resolve(bin), new AbortController().signal);
    process.env.PRAXIS_TEST_DATABASE_URL = cluster.url;
    fixture = await chatFixture();
    await fixture.auth.saveProvider(
      fixture.identity,
      { ...provider, name: '桌面验收测试模型（不联网）', adapter: 'fixture.desktop/model' },
      'fixture-only-vendor-key',
      fixture.config.id,
      1,
    );
    const listening = await listenFixture(fixture);
    server = listening.server;
    const serverUrl = listening.serverUrl;
    const key = await fixture.auth.createApiKey(
      fixture.identity,
      'disposable-desktop-test',
      ['profile:read', 'providers:read', 'providers:write', 'client:direct'],
      1,
    );
    const entry = await setupDesktop(root, serverUrl, key.key);
    console.log(
      JSON.stringify({ fixture: true, pid: process.pid, root, entry, serverUrl, apiKey: key.key }),
    );
    if (!controller.signal.aborted) await once(controller.signal, 'abort');
  } finally {
    clearTimeout(deadline);
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    server?.close();
    if (server && 'closeAllConnections' in server) server.closeAllConnections();
    try {
      await fixture?.close();
    } finally {
      try {
        await cluster?.close();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  }
}

async function listenFixture(fixture: Awaited<ReturnType<typeof chatFixture>>) {
  const server = serve({
    fetch: createApp(fixture.auth, fixture.runtime, 'http://127.0.0.1:4310').fetch,
    hostname: '127.0.0.1',
    port: 0,
  });
  try {
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture address.');
    return { server, serverUrl: `http://127.0.0.1:${address.port}` };
  } catch (error) {
    server.close();
    throw error;
  }
}
await main();
