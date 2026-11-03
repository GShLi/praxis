import { once } from 'node:events';
import { mcpHttpFixture } from '../fixtures/mcp-http.ts';

/** Loopback-only disposable MCP peer for native UI acceptance; never a real vendor. */
async function main() {
  const fixture = await mcpHttpFixture(false, true, true);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  const timer = setTimeout(stop, 3_600_000);
  try {
    fixture.remote.inputRequired = process.argv.includes('--form');
    console.log(JSON.stringify({ fixture: true, pid: process.pid, endpoint: fixture.endpoint }));
    if (!controller.signal.aborted) await once(controller.signal, 'abort');
  } finally {
    clearTimeout(timer);
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
    await fixture.close();
    console.log(JSON.stringify({ methods: [...new Set(fixture.requests.map((r) => r.method))] }));
  }
}
await main();
