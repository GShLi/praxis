import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { namespaceMembers } from './linux-isolation-fixture.ts';

function privateViewArgs() {
  return [
    '--unshare-all',
    '--die-with-parent',
    '--new-session',
    '--uid',
    '0',
    '--gid',
    '0',
    '--cap-add',
    'CAP_SYS_ADMIN',
    '--ro-bind',
    '/',
    '/',
    '--tmpfs',
    '/tmp',
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--dev-bind',
    '/dev/fuse',
    '/dev/fuse',
    '--chdir',
    process.cwd(),
    process.execPath,
    '--import',
    'tsx',
    'tests/platform/linux-view-worker.ts',
  ];
}

async function startViewHost() {
  assert.equal(process.platform, 'linux');
  const args = privateViewArgs();
  const source = `const {spawn}=require('node:child_process');
    const child=spawn('/usr/bin/bwrap', ${JSON.stringify(args)}, {stdio:'inherit'});
    child.on('error', () => process.exit(71));
    child.on('exit', (code) => process.exit(code ?? 72));`;
  const child = spawn(process.execPath, ['-e', source], {
    env: {
      PATH: '/usr/bin:/bin',
      PRAXIS_TEST_FUSE_INCLUDE: process.env.PRAXIS_TEST_FUSE_INCLUDE ?? '/usr/include/fuse3',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-8192);
  });
  const closed = once(child, 'close');
  void closed.catch(() => {});
  const lines = createInterface({ input: child.stdout });
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  const close = async () => {
    child.kill('SIGKILL');
    try {
      await closed;
    } finally {
      clearTimeout(timer);
      lines.close();
    }
  };
  try {
    const [line] = await Promise.race([
      once(lines, 'line', { signal: AbortSignal.timeout(8000) }),
      closed.then(() => {
        throw new Error(`Private view startup failed: ${stderr}`);
      }),
    ]);
    const record = JSON.parse(String(line));
    assert.match(record.namespace, /^pid:\[\d+\]$/);
    return { child, closed, close, namespace: String(record.namespace) };
  } catch (error) {
    await close();
    throw error;
  }
}

for (const failure of ['host', 'view'] as const)
  test(`Linux private mount/pid namespace releases the filtered view after ${failure} SIGKILL`, async () => {
    const hostMounts = (await readFile('/proc/self/mountinfo', 'utf8'))
      .split('\n')
      .filter((line) => line.includes('praxis-view-'));
    const host = await startViewHost();
    try {
      assert((await namespaceMembers(host.namespace)).length >= 2);
      if (failure === 'host') host.child.kill('SIGKILL');
      else host.child.stdin.end('crash-view\n');
      await host.closed;
      for (
        let attempt = 0;
        attempt < 100 && (await namespaceMembers(host.namespace)).length;
        attempt++
      )
        await delay(10);
      assert.deepEqual(await namespaceMembers(host.namespace), []);
      assert.deepEqual(
        (await readFile('/proc/self/mountinfo', 'utf8'))
          .split('\n')
          .filter((line) => line.includes('praxis-view-')),
        hostMounts,
      );
    } finally {
      await host.close();
    }
  });
