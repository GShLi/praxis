import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('Linux private OS keyring preserves exact credentials across service restart and deletion', async () => {
  await isolated('round-trip');
});

test('Linux private OS keyring never truncates credentials at the secret-tool input limit', async () => {
  await isolated('limits');
});

async function isolated(scenario: string) {
  assert.equal(process.platform, 'linux');
  const helper = process.env.PRAXIS_TEST_KEYRING_HELPER ?? '/usr/bin/gnome-keyring-daemon';
  await access(helper, constants.X_OK);
  await access('/usr/bin/secret-tool', constants.X_OK);
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-private-keyring-'));
  try {
    for (const name of ['runtime', 'data', 'control'])
      await mkdir(path.join(root, name), { mode: 0o700 });
    await runWorker(scenario, {
      PATH: '/usr/bin:/bin',
      HOME: root,
      XDG_RUNTIME_DIR: path.join(root, 'runtime'),
      XDG_DATA_HOME: path.join(root, 'data'),
      PRAXIS_TEST_PRIVATE_KEYRING: '1',
      PRAXIS_TEST_KEYRING_HELPER: helper,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function runWorker(scenario: string, env: NodeJS.ProcessEnv) {
  const child = spawn(
    '/usr/bin/dbus-run-session',
    ['--', process.execPath, '--import', 'tsx', 'tests/platform/linux-keyring-worker.ts', scenario],
    { env, detached: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  // This group contains only fixed test programs; it is not the Agent's sandbox backend.
  const kill = () => {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
  };
  return new Promise<void>((resolve, reject) => {
    let diagnostic = '';
    const timer = setTimeout(kill, 20000);
    child.stderr.on('data', (chunk: Buffer) => {
      diagnostic = (diagnostic + chunk.toString()).slice(-4096);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Private keyring test failed (${code}): ${diagnostic}`));
    });
  });
}
