import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
const execute = promisify(execFile);

/** Mechanism-only policy. Does not provide a production supervisor or protected-alias policy. */
export async function macosIsolationFixture() {
  assert.equal(process.platform, 'darwin', 'This suite requires native macOS.');
  const root = await realpath(await mkdtemp('/tmp/praxis-seatbelt-'));
  const binary = path.join(root, 'probe');
  const workspace = path.join(root, 'workspace');
  const temporary = path.join(root, 'temporary');
  const outside = path.join(root, 'host-only.txt');
  try {
    await mkdir(workspace);
    await mkdir(temporary);
    await writeFile(outside, 'disposable outside fixture');
    await writeFile(path.join(workspace, 'input.txt'), 'disposable workspace fixture');
    await writeFile(path.join(temporary, 'scratch.txt'), 'disposable temporary fixture');
    await execute(
      '/usr/bin/cc',
      [
        '-Wall',
        '-Wextra',
        '-Werror',
        '-O2',
        'tests/platform/posix-isolation-probe.c',
        '-o',
        binary,
      ],
      { timeout: 30000 },
    );
    return {
      root,
      workspace,
      temporary,
      outside,
      binary,
      run: (operation: string, target: string, writable = false) =>
        run(binary, workspace, temporary, operation, target, writable),
      close: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

function run(
  binary: string,
  workspace: string,
  temporary: string,
  operation: string,
  target: string,
  writable: boolean,
) {
  const quote = (value: string) => JSON.stringify(value);
  const profile = [
    '(version 1)',
    '(deny default)',
    '(allow process-exec process-fork)',
    '(allow sysctl-read)',
    '(allow file-read-metadata)',
    // dyld/libignition opens the root directory as its openat base (dyld-support.sb).
    '(allow file-read* (literal "/"))',
    `(allow file-read* file-map-executable (subpath "/System") (subpath "/usr/lib") (literal ${quote(binary)}))`,
    `(allow file-read* (subpath ${quote(workspace)}))`,
    `(allow file-read* file-write* (subpath ${quote(temporary)}))`,
    '(allow file-write* (literal "/dev/null"))',
    ...(writable ? [`(allow file-write* (subpath ${quote(workspace)}))`] : []),
  ].join('\n');
  const result = spawnSync('/usr/bin/sandbox-exec', ['-p', profile, binary, operation, target], {
    env: { PATH: '/usr/bin:/bin', HOME: temporary, TMPDIR: temporary },
    input: '',
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 4096,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.ok(
    result.status === 0 || result.status === 10,
    `Unexpected probe result: ${result.status} ${result.stderr}`,
  );
  return result.status;
}
