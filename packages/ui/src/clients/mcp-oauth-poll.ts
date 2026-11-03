import type { PraxisClient } from '../client-types.ts';

/** The view owns cancellation; a late RPC reply cannot update a disposed identity/view. */
export async function pollMcpOAuth(client: PraxisClient, id: string, signal: AbortSignal) {
  for (;;) {
    signal.throwIfAborted();
    const result = await client.mcpOAuthStatus!(id);
    signal.throwIfAborted();
    if (!['waiting', 'exchanging'].includes(result.status)) return result;
    await new Promise<void>((resolve, reject) => {
      const cancel = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', cancel);
        resolve();
      }, 1000);
      signal.addEventListener('abort', cancel, { once: true });
    });
  }
}
