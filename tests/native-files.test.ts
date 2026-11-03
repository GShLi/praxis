import { WorkspaceFiles } from '@praxis/tools/files';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  writeFile,
  rename,
  rm,
  symlink,
} from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('native files create nested UTF-8 paths and preserve exact bytes through read and replacement', async () => {
  const f = await fixture();
  try {
    const name = '目录/child/hello.txt',
      content = '\ufeffHello 世界\r\n';
    const written = await f.files.write(
      { path: name, mode: 'create', content, createParents: true },
      f.signal,
    );
    assert.equal(written.createdDirectories.length, 2);
    const read = await f.files.read({ path: name, startLine: 1, lineCount: 10 });
    assert.equal(read.lines[0]?.text, '\ufeffHello 世界');
    await f.files.write(
      { path: name, mode: 'replace', expectedVersion: read.fileVersion, content: 'changed\n' },
      f.signal,
    );
    assert.equal(await readFile(path.join(f.workspace, name), 'utf8'), 'changed\n');
    assert.deepEqual(
      (await f.files.list({ path: '目录/child', includeHidden: true, limit: 100 })).entries.map(
        (e) => e.name,
      ),
      ['hello.txt'],
    );
  } finally {
    await f.close();
  }
});

test('replacing the workspace root invalidates old handles and observations', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.workspace, 'text.txt'), 'original');
    await f.files.read({ path: 'text.txt', startLine: 1, lineCount: 10 });
    await rename(f.workspace, path.join(f.root, 'old'));
    await mkdir(f.workspace);
    await writeFile(path.join(f.workspace, 'text.txt'), 'substituted');
    await assert.rejects(f.files.read({ path: 'text.txt', startLine: 1, lineCount: 10 }), {
      code: 'WORKSPACE_CHANGED',
    });
    await assert.rejects(f.files.list({ path: '.', includeHidden: true, limit: 100 }), {
      code: 'WORKSPACE_CHANGED',
    });
    await assert.rejects(
      f.files.write({ path: 'new.txt', mode: 'create', content: 'no' }, f.signal),
      { code: 'WORKSPACE_CHANGED' },
    );
    assert.deepEqual(await readdir(f.workspace), ['text.txt']);
  } finally {
    await f.close();
  }
});

test('native publication refuses a file changed during final permission checking and cleans temporary files', async () => {
  const f = await fixture();
  let checks = 0;
  try {
    const target = path.join(f.workspace, 'text.txt');
    await writeFile(target, 'old');
    const files = await WorkspaceFiles.open(
      f.workspace,
      () => 'artifact',
      [],
      () => {
        if (++checks === 2) writeFileSync(target, 'external edit');
      },
    );
    const read = await files.read({ path: target, startLine: 1, lineCount: 10 });
    await assert.rejects(
      files.write(
        {
          path: target,
          mode: 'replace',
          expectedVersion: read.fileVersion,
          content: 'replacement',
        },
        f.signal,
      ),
      { code: 'FILE_VERSION_CONFLICT' },
    );
    assert.equal(await readFile(target, 'utf8'), 'external edit');
    assert.deepEqual(await readdir(f.workspace), ['text.txt']);
  } finally {
    await f.close();
  }
});

test('cancelling at the native commit boundary leaves no file or temporary content', async () => {
  const f = await fixture();
  const scope = new AbortController();
  let checks = 0;
  try {
    const files = await WorkspaceFiles.open(
      f.workspace,
      () => 'artifact',
      [],
      () => {
        if (++checks === 2) scope.abort(new Error('cancel before publish'));
      },
    );
    await assert.rejects(
      files.write({ path: 'text.txt', mode: 'create', content: 'private fixture' }, scope.signal),
      /cancel before publish/,
    );
    assert.equal(checks, 2);
    assert.deepEqual(await readdir(f.workspace), []);
  } finally {
    await f.close();
  }
});

test('native reads support allowed in-workspace links and reject non-text and oversized files', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.workspace, 'text.txt'), 'okay');
    await mkdir(path.join(f.workspace, 'folder'));
    await writeFile(path.join(f.workspace, 'folder', 'file.txt'), 'okay');
    await symlink(
      path.join(f.workspace, 'folder'),
      path.join(f.workspace, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    assert.equal(
      (await f.files.read({ path: 'linked/file.txt', startLine: 1, lineCount: 10 })).lines[0]?.text,
      'okay',
    );
    await writeFile(path.join(f.workspace, 'binary.dat'), Buffer.from([255, 0, 1]));
    await assert.rejects(f.files.read({ path: 'binary.dat', startLine: 1, lineCount: 10 }), {
      code: 'UNSUPPORTED_ENCODING',
    });
    await writeFile(path.join(f.workspace, 'large.txt'), Buffer.alloc(2 * 1024 * 1024 + 1, 65));
    await assert.rejects(f.files.read({ path: 'large.txt', startLine: 1, lineCount: 10 }), {
      code: 'FILE_TOO_LARGE',
    });
  } finally {
    await f.close();
  }
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-native-files-')),
    workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  const files = await WorkspaceFiles.open(workspace, () => 'artifact');
  return {
    root,
    workspace: files.root,
    files,
    signal: AbortSignal.timeout(10000),
    close: () => rm(root, { recursive: true, force: true }),
  };
}
