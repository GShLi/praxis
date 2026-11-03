import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

async function mounted(mount: string) {
  const encoded = mount.replace(
    /[\x20\t\n\\]/g,
    (character) => `\\${character.charCodeAt(0).toString(8).padStart(3, '0')}`,
  );
  return (await readFile('/proc/self/mountinfo', 'utf8'))
    .split('\n')
    .some((line) => line.split(' ')[4] === encoded);
}

export async function viewFixture() {
  assert.equal(process.platform, 'linux', 'This suite requires native Linux and FUSE3.');
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-view-'));
  const workspace = path.join(root, 'work'),
    mount = path.join(root, 'view');
  await mkdir(workspace);
  await mkdir(mount);
  const binary = path.join(root, 'praxis-workspace-view');
  try {
    execFileSync(
      'cc',
      [
        '-Wall',
        '-Wextra',
        '-Werror',
        '-O2',
        `-I${process.env.PRAXIS_TEST_FUSE_INCLUDE ?? '/usr/include/fuse3'}`,
        'native/workspace-view/main.c',
        'native/workspace-view/path.c',
        'native/workspace-view/read.c',
        '-l:libfuse3.so.3',
        '-pthread',
        '-o',
        binary,
      ],
      { timeout: 30_000 },
    );
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  return {
    root,
    workspace,
    mount,
    binary,
    close: async () => {
      if (await mounted(mount))
        execFileSync('/usr/bin/fusermount3', ['-u', '--', mount], { timeout: 5000 });
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function mountView(f: Awaited<ReturnType<typeof viewFixture>>, denied: string[] = []) {
  const identity = await stat(f.workspace, { bigint: true });
  const child = spawn(
    f.binary,
    [f.workspace, `${identity.dev}:${identity.ino}`, f.mount, ...denied],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin' },
    },
  );
  const closed = once(child, 'close');
  void closed.catch(() => {});
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-8192);
  });
  const lines = createInterface({ input: child.stdout });
  const close = async (force = false) => {
    child.kill(force ? 'SIGKILL' : 'SIGTERM');
    const deadline = setTimeout(() => child.kill('SIGKILL'), 5000);
    try {
      await closed;
    } finally {
      clearTimeout(deadline);
      lines.close();
    }
    // Ubuntu 22.04 fusermount3 3.10.5 cannot reliably auto-unmount after SIGKILL.
    // A live owner explicitly releases its own mount; crash tests use a private mount namespace.
    if (force && (await mounted(f.mount)))
      execFileSync('/usr/bin/fusermount3', ['-u', '--', f.mount], { timeout: 5000 });
    for (let attempt = 0; attempt < 100 && (await mounted(f.mount)); attempt++) await delay(10);
    assert.equal(await mounted(f.mount), false, 'private FUSE mount remained after exit');
  };
  try {
    const ready = once(lines, 'line', { signal: AbortSignal.timeout(5000) });
    const result = await Promise.race([
      ready,
      closed.then(() => {
        throw new Error(`View failed to mount: ${stderr}`);
      }),
    ]);
    assert.equal(result[0], 'ready');
    return { child, close };
  } catch (error) {
    await close(true);
    throw error;
  }
}
