import { serve } from '@hono/node-server';
import type { AuthService } from '@praxis/auth';
import { assert } from '@praxis/contracts';
import type { PostgresDatabase } from '@praxis/storage-server';
import { createApp } from './app.ts';
import { createChatService } from './chat-service.ts';
import { serverConfig } from './config.ts';

/** One lifetime owns the database lease, HTTP listener and Chat runtime. */
export async function runServer(database: PostgresDatabase, auth: AuthService, webRoot: string) {
  const config = serverConfig();
  const controller = new AbortController();
  const stop = () => controller.abort();
  const shutdown = new Promise<void>((resolve) =>
    controller.signal.addEventListener('abort', () => resolve(), { once: true }),
  );
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  const connect = () => database.pool.connect();
  let lease: Awaited<ReturnType<typeof connect>> | undefined;
  let server: ReturnType<typeof serve> | undefined;
  const chat = createChatService(database, auth);
  let locked = false;
  try {
    lease = await database.pool.connect();
    lease.on('error', stop);
    const result = await lease.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(707261786974) AS acquired',
    );
    locked = result.rows[0]?.acquired === true;
    assert(locked, 'SERVER_ALREADY_RUNNING', '数据库已有 Praxis 服务实例。');
    if (controller.signal.aborted) return;
    await chat.recover();
    if (controller.signal.aborted) return;
    const app = createApp(auth, chat, config.origin, webRoot);
    server = serve({ fetch: app.fetch, port: config.port, hostname: config.hostname });
    const listener = server;
    await new Promise<void>((resolve, reject) => {
      const listening = () => {
        server?.off('error', reject);
        resolve();
      };
      listener.once('error', reject);
      listener.once('listening', listening);
    });
    server.on('error', stop);
    console.log(`Praxis Server: ${config.origin}`);
    await shutdown;
  } finally {
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
    server?.off('error', stop);
    // Stop accepting HTTP requests before cancelling model streams and releasing the lease.
    server?.close();
    if (server && 'closeAllConnections' in server) server.closeAllConnections();
    try {
      await chat.close();
    } finally {
      if (lease) {
        lease.off('error', stop);
        try {
          if (locked) await lease.query('SELECT pg_advisory_unlock(707261786974)');
        } finally {
          lease.release();
        }
      }
    }
  }
}
