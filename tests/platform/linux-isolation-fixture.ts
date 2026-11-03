import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readdir, readlink } from 'node:fs/promises';
import { createInterface } from 'node:readline';

/** Mechanism probe only: not the production execution policy or a ProcessService. */
export const isolationArgs = [
  '--unshare-all',
  '--die-with-parent',
  '--new-session',
  '--cap-drop',
  'ALL',
  '--clearenv',
  '--setenv',
  'PATH',
  '/usr/bin:/bin',
  '--ro-bind',
  '/usr',
  '/usr',
  '--symlink',
  'usr/bin',
  '/bin',
  '--symlink',
  'usr/lib',
  '/lib',
  '--symlink',
  'usr/lib64',
  '/lib64',
  '--proc',
  '/proc',
  '--dev',
  '/dev',
  '--tmpfs',
  '/tmp',
];

export function runIsolated(program: string, args: string[] = [], mounts: string[] = []) {
  assert.equal(process.platform, 'linux', 'Run this suite on native Linux.');
  const result = spawnSync(
    '/usr/bin/bwrap',
    [...isolationArgs, ...mounts, '/usr/bin/python3', '-c', program, ...args],
    {
      env: { PRAXIS_PROBE_FAKE_SECRET: 'disposable-test-value' },
      input: '',
      encoding: 'utf8',
      timeout: 5000,
      killSignal: 'SIGKILL',
      maxBuffer: 65536,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

export async function namespaceMembers(namespace: string) {
  assert.match(namespace, /^pid:\[\d+\]$/);
  const result: number[] = [];
  for (const name of await readdir('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      if ((await readlink(`/proc/${name}/ns/pid`)) === namespace) result.push(Number(name));
    } catch (error) {
      if (
        !['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        )
      )
        throw error;
    }
  }
  return result;
}

export async function startIsolatedHost(program: string) {
  assert.equal(process.platform, 'linux', 'Run this suite on native Linux.');
  const args = [...isolationArgs, '/usr/bin/python3', '-c', program];
  // The intermediate process represents a crashed Host. Its child inherits the private pipes.
  const source = `const {spawn}=require('node:child_process');
    const child=spawn('/usr/bin/bwrap', ${JSON.stringify(args)}, {stdio:'inherit', env:{}});
    child.once('error', () => process.exit(70));
    child.once('exit', () => process.exit(0));`;
  const host = spawn(process.execPath, ['-e', source], {
    env: {},
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const closed = once(host, 'close');
  // Attach immediately: startup errors must not leave an unhandled rejection.
  void closed.catch(() => {});
  host.stderr.resume();
  const lines = createInterface({ input: host.stdout });
  const timer = setTimeout(() => host.kill('SIGKILL'), 8000);
  const close = async () => {
    host.kill('SIGKILL');
    try {
      await closed;
    } finally {
      clearTimeout(timer);
      lines.close();
    }
  };
  try {
    const [namespace] = await once(lines, 'line', { signal: AbortSignal.timeout(5000) });
    assert.equal(typeof namespace, 'string');
    assert.match(namespace, /^pid:\[\d+\]$/);
    return { host, namespace: String(namespace), closed, close };
  } catch (error) {
    await close();
    throw error;
  }
}
