import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { link, mkdir, open, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { runIsolated } from './linux-isolation-fixture.ts';
import { mountView, viewFixture } from './linux-view-fixture.ts';

test('Linux read-only filtered view permits ordinary files and hides protected names, hardlinks and symlinks', async () => {
  const f = await viewFixture();
  try {
    await writeFile(path.join(f.workspace, 'hello.txt'), '你好 Praxis');
    await writeFile(path.join(f.workspace, '.env'), 'disposable-sensitive-value');
    await link(path.join(f.workspace, '.env'), path.join(f.workspace, 'ordinary-alias.txt'));
    await symlink('.env', path.join(f.workspace, 'relative-link'));
    await symlink('/etc/passwd', path.join(f.workspace, 'external-link'));
    await mkdir(path.join(f.workspace, '.GIT'));
    await writeFile(path.join(f.workspace, '.GIT', 'config'), 'private');
    await writeFile(path.join(f.workspace, 'client.PEM'), 'private');
    const view = await mountView(f);
    try {
      assert.equal(await readFile(path.join(f.mount, 'hello.txt'), 'utf8'), '你好 Praxis');
      assert.deepEqual(await readdir(f.mount), ['hello.txt']);
      for (const file of [
        '.env',
        'ordinary-alias.txt',
        'relative-link',
        'external-link',
        '.GIT/config',
        'client.PEM',
      ])
        await assert.rejects(readFile(path.join(f.mount, file)));
      await assert.rejects(writeFile(path.join(f.mount, 'hello.txt'), 'changed'));
      assert.equal(await readFile(path.join(f.workspace, 'hello.txt'), 'utf8'), '你好 Praxis');
    } finally {
      await view.close();
    }
  } finally {
    await f.close();
  }
});

test('Linux explicit private directory remains denied after an external rename and namespace mounting', async () => {
  const f = await viewFixture();
  try {
    await mkdir(path.join(f.workspace, 'private'));
    await writeFile(path.join(f.workspace, 'private', 'secret.txt'), 'fixture-secret');
    await writeFile(path.join(f.workspace, 'hello.txt'), 'public');
    const view = await mountView(f, ['/private']);
    try {
      const opened = await open(path.join(f.mount, 'hello.txt'), 'r');
      try {
        await rename(path.join(f.workspace, 'private'), path.join(f.workspace, 'alias'));
        await assert.rejects(opened.read(Buffer.alloc(6), 0, 6, 0));
      } finally {
        await opened.close();
      }
      await mkdir(path.join(f.workspace, 'private'));
      await writeFile(path.join(f.workspace, 'private', 'new.txt'), 'private-new');
      assert.deepEqual(await readdir(f.mount), []);
      await assert.rejects(readFile(path.join(f.mount, 'hello.txt')));
      const result = runIsolated(
        `import pathlib
for name in ['hello.txt', 'alias/secret.txt', 'private/new.txt']:
    try: pathlib.Path('/work', name).read_bytes()
    except OSError: pass
    else: raise AssertionError('private file became visible')
print('filtered')`,
        [],
        ['--ro-bind', f.mount, '/work'],
      );
      assert.equal(result, 'filtered');
    } finally {
      await view.close();
    }
  } finally {
    await f.close();
  }
});

test('Linux view pins workspace identity and its owner releases a forcibly stopped view', async () => {
  const f = await viewFixture();
  try {
    const rejected = spawnSync(f.binary, [f.workspace, '0:0', f.mount], { timeout: 5000 });
    assert.equal(rejected.status, 65);
    await writeFile(path.join(f.workspace, 'hello.txt'), 'pinned');
    const view = await mountView(f);
    try {
      await rename(f.workspace, path.join(f.root, 'original'));
      await mkdir(f.workspace);
      await writeFile(path.join(f.workspace, 'hello.txt'), 'replacement');
      assert.equal(await readFile(path.join(f.mount, 'hello.txt'), 'utf8'), 'pinned');
    } finally {
      await view.close(true);
    }
  } finally {
    await f.close();
  }
});
