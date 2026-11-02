import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { once } from 'node:events';
import { PROTOCOL, assert } from '../../contracts/src/index.ts';
import { JsonLines, RpcClient } from '../../transport/src/index.ts';

export async function startHost(
  kind: 'cli' | 'desktop',
  env: NodeJS.ProcessEnv = {},
  entry?: string,
) {
  entry ??= process.argv[1]?.endsWith('cli.mjs')
    ? path.join(path.dirname(process.argv[1]), 'host.mjs')
    : undefined;
  const child = spawn(
    process.execPath,
    entry
      ? [entry]
      : [
          '--import',
          'tsx',
          fileURLToPath(new URL('../../../apps/agent-host/src/main.ts', import.meta.url)),
        ],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...env,
        ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      },
      windowsHide: true,
    },
  );
  // Diagnostics are intentionally not blindly copied: stderr may contain private paths.
  child.stderr.resume();
  const rpc = new RpcClient(new JsonLines(child.stdout, child.stdin));
  child.on('error', () => rpc.channel.close());
  child.on('exit', () => rpc.channel.close());
  const nonce = randomUUID();
  try {
    const reply = await rpc.request<{ major: number; nonce: string }>('host/initialize', {
      protocolMajor: PROTOCOL.major,
      protocolMinor: PROTOCOL.minor,
      clientInstanceId: randomUUID(),
      clientKind: kind,
      nonce,
    });
    assert(
      reply.major === PROTOCOL.major && reply.nonce === nonce,
      'PROTOCOL_MISMATCH',
      'Host 握手失败。',
    );
  } catch (error) {
    child.kill();
    throw error;
  }
  const heartbeat = setInterval(() => {
    void rpc.request('host/ping', {}, 5000).catch(() => child.kill());
  }, 5000);
  heartbeat.unref();
  const stopOnExit = () => {
    child.stdin.end();
  };
  process.once('exit', stopOnExit);
  const closed = once(child, 'exit');
  return {
    rpc,
    pid: child.pid,
    async close() {
      clearInterval(heartbeat);
      process.off('exit', stopOnExit);
      if (child.exitCode !== null || child.signalCode !== null) return;
      const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
      try {
        await rpc.request('host/shutdown', {}, 1000).catch(() => child.stdin.end());
        await closed;
      } finally {
        clearTimeout(kill);
        rpc.channel.close();
      }
    },
  };
}
