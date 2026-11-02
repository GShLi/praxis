import { spawn, execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
const execute = promisify(execFile);

/** Owns an isolated, temporary Unix-socket cluster. No system service or existing DB is touched. */
export async function localCluster(bin: string, signal: AbortSignal) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'praxis-pg-'));
  const data = path.join(directory, 'data');
  let child: ReturnType<typeof spawn> | undefined;
  let exited: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  const stop = () => child?.kill('SIGINT');
  signal.addEventListener('abort', stop, { once: true });
  const close = async () => {
    signal.removeEventListener('abort', stop);
    if (child && child.exitCode === null && child.signalCode === null) {
      const deadline = setTimeout(() => child?.kill('SIGKILL'), 5000);
      child.kill('SIGINT'); // PostgreSQL fast shutdown rolls back clients and flushes storage.
      try {
        await exited;
      } finally {
        clearTimeout(deadline);
      }
    }
    await rm(directory, { recursive: true, force: true });
  };
  try {
    signal.throwIfAborted();
    await initializeCluster(bin, data, signal);
    signal.throwIfAborted();
    child = spawn(
      path.join(bin, 'postgres'),
      ['-D', data, '-k', directory, '-h', '', '-p', '55432'],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    const server = child;
    exited = new Promise<void>((resolve) => {
      server.once('exit', () => resolve());
      server.once('error', () => resolve());
    });
    await waitReady(server);
    server.stderr?.resume();
    const url = new URL('postgresql://praxis_test@localhost:55432/postgres');
    url.searchParams.set('host', directory);
    return { url: url.href, close: () => (closing ??= close()) };
  } catch (error) {
    await close();
    throw error;
  }
}

function waitReady(server: ReturnType<typeof spawn>) {
  return new Promise<void>((resolve, reject) => {
    let diagnostic = '';
    const timer = setTimeout(
      () => finish(new Error('Temporary PostgreSQL startup timed out.')),
      15000,
    );
    const failed = () =>
      finish(new Error('Temporary PostgreSQL startup failed. ' + diagnostic.slice(-2000)));
    const data = (chunk: Buffer) => {
      diagnostic += chunk.toString();
      if (diagnostic.includes('database system is ready to accept connections')) finish();
    };
    const finish = (error?: Error) => {
      clearTimeout(timer);
      server.stderr?.off('data', data);
      server.off('error', failed);
      server.off('exit', failed);
      if (error) reject(error);
      else resolve();
    };
    server.stderr?.on('data', data);
    server.once('error', failed);
    server.once('exit', failed);
  });
}

async function initializeCluster(bin: string, data: string, signal: AbortSignal) {
  await execute(
    path.join(bin, 'initdb'),
    [
      '-D',
      data,
      '-A',
      'trust',
      '--no-locale',
      '-E',
      'UTF8',
      '-U',
      'praxis_test',
      ...(process.env.PRAXIS_TEST_PG_SHARE
        ? ['-L', path.resolve(process.env.PRAXIS_TEST_PG_SHARE)]
        : []),
    ],
    { timeout: 30000, signal },
  );
}
