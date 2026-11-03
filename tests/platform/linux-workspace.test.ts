import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runIsolated } from './linux-isolation-fixture.ts';

const workspaceProbe = `import errno, os, sys
assert open('/workspace/input.txt').read() == 'fixture input'
assert not os.path.exists(sys.argv[2])
for target in ['/workspace/absolute-link', '/workspace/relative-link']:
    try:
        with open(target) as file: file.read()
    except OSError as error:
        assert error.errno in (errno.ENOENT, errno.EACCES)
    else:
        raise AssertionError('host-only file was visible through a symlink')
readonly = sys.argv[1] == 'readonly'
assert bool(os.statvfs('/workspace').f_flag & os.ST_RDONLY) == readonly
for target in ['/workspace/input.txt', '/workspace/new.txt']:
    try:
        with open(target, 'w') as file: file.write('fixture output')
    except OSError as error:
        assert readonly and error.errno in (errno.EROFS, errno.EACCES)
    else:
        assert not readonly
print('verified')`;

test('Linux workspace mounts enforce read-only/write modes and hide host-only symlink targets', async () => {
  assert.equal(process.platform, 'linux', 'Run this suite on native Linux.');
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-isolation-workspace-'));
  try {
    const workspace = path.join(root, 'workspace');
    const outside = path.join(root, 'host-only.txt');
    await mkdir(workspace);
    await writeFile(outside, 'disposable host fixture');
    await writeFile(path.join(workspace, 'input.txt'), 'fixture input');
    await symlink(outside, path.join(workspace, 'absolute-link'));
    await symlink('../host-only.txt', path.join(workspace, 'relative-link'));
    for (const mode of ['readonly', 'writable']) {
      const output = runIsolated(
        workspaceProbe,
        [mode, outside],
        [mode === 'readonly' ? '--ro-bind' : '--bind', workspace, '/workspace'],
      );
      assert.equal(output, 'verified');
      const expected = mode === 'readonly' ? 'fixture input' : 'fixture output';
      assert.equal(await readFile(path.join(workspace, 'input.txt'), 'utf8'), expected);
    }
    assert.equal(await readFile(path.join(workspace, 'new.txt'), 'utf8'), 'fixture output');
    assert.equal(await readFile(outside, 'utf8'), 'disposable host fixture');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
