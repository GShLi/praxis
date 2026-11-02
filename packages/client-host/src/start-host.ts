import { PROTOCOL, assert } from '@praxis/contracts';
import { JsonLines, RpcClient } from '@praxis/transport';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const closed = new Promise<void>((resolve) => {
    child.once('error', () => {
      rpc.channel.close();
      resolve();
    });
    child.once('exit', () => {
      rpc.channel.close();
      resolve();
    });
  });
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
    child.kill('SIGKILL');
    await closed;
    rpc.channel.close();
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
  const release = () => {
    clearInterval(heartbeat);
    process.off('exit', stopOnExit);
  };
  void closed.then(release);
  let closing: Promise<void> | undefined;
  const close = async () => {
    release();
    if (child.exitCode !== null || child.signalCode !== null) {
      rpc.channel.close();
      return;
    }
    const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
    try {
      await rpc.request('host/shutdown', {}, 1000).catch(() => child.stdin.end());
      await closed;
    } finally {
      clearTimeout(kill);
      rpc.channel.close();
    }
  };
  return { rpc, pid: child.pid, close: () => (closing ??= close()) };
}
