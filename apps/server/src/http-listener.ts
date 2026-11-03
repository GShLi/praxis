import type { serve } from '@hono/node-server';

/** The caller owns the server and must close it even if listening fails. */
export function waitForListener(server: ReturnType<typeof serve>, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      server.off('listening', listening);
      server.off('error', failed);
      signal.removeEventListener('abort', aborted);
    };
    const listening = () => {
      cleanup();
      resolve();
    };
    const failed = (error: Error) => {
      cleanup();
      reject(error);
    };
    const aborted = () => {
      cleanup();
      reject(signal.reason);
    };
    if (signal.aborted) {
      aborted();
      return;
    }
    server.once('listening', listening);
    server.once('error', failed);
    signal.addEventListener('abort', aborted, { once: true });
  });
}
