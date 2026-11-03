import { serve } from '@hono/node-server';
import type { AuthService } from '@praxis/auth';
import type { PostgresDatabase } from '@praxis/storage-server';
import { createApp } from './app.ts';
import { createChatService } from './chat-service.ts';
import { serverConfig } from './config.ts';
import { serverModels } from './model-plugins.ts';
import { ServerDiagnostics } from './diagnostics.ts';
import { waitForListener } from './http-listener.ts';
import { acquireServerLease } from './server-lease.ts';

/** One lifetime owns the database lease, HTTP listener and Chat runtime. */
export async function runServer(database: PostgresDatabase, auth: AuthService, webRoot: string) {
  const config = serverConfig();
  const providers = await serverModels();
  const controller = new AbortController();
  const stop = () => controller.abort();
  const shutdown = new Promise<void>((resolve) =>
    controller.signal.addEventListener('abort', () => resolve(), { once: true }),
  );
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  let lease: Awaited<ReturnType<typeof acquireServerLease>> | undefined;
  let server: ReturnType<typeof serve> | undefined;
  let diagnostics: ServerDiagnostics | undefined;
  const chat = createChatService(database, auth, providers.model);
  try {
    lease = await acquireServerLease(database, stop);
    if (controller.signal.aborted) return;
    diagnostics = await ServerDiagnostics.open(chat, config.origin, stop);
    if (controller.signal.aborted) return;
    await chat.recover();
    if (controller.signal.aborted) return;
    const app = createApp(auth, chat, config.origin, webRoot, undefined, diagnostics);
    server = serve({ fetch: app.fetch, port: config.port, hostname: config.hostname });
    await waitForListener(server, controller.signal);
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
      try {
        await diagnostics?.close();
      } finally {
        try {
          await providers.close();
        } finally {
          await lease?.close();
        }
      }
    }
  }
}
