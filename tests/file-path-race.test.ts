import { WorkspaceFiles } from '@praxis/tools/files';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readdir } from 'node:fs/promises';
import { renameSync, symlinkSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('replacing a parent directory during final authorization never publishes outside the workspace', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-path-race-'));
  const workspace = path.join(root, 'workspace'),
    outside = path.join(root, 'outside');
  const safe = path.join(workspace, 'safe');
  await mkdir(safe, { recursive: true });
  await mkdir(outside);
  let checks = 0;
  try {
    const files = await WorkspaceFiles.open(
      workspace,
      () => 'artifact',
      [],
      () => {
        if (++checks !== 2) return;
        const temporary = readdirSync(safe).filter((name) => name.startsWith('.praxis-'));
        renameSync(safe, path.join(workspace, 'moved'));
        symlinkSync(outside, safe, process.platform === 'win32' ? 'junction' : 'dir');
        for (const name of temporary) writeFileSync(path.join(outside, name), 'outside sentinel');
      },
    );
    await files
      .write(
        { path: 'safe/result.txt', mode: 'create', content: 'Hello World' },
        AbortSignal.timeout(10000),
      )
      .catch(() => {
        /* Changing the authorized path may legitimately reject or make publication uncertain. */
      });
    assert.equal(checks, 2);
    assert.ok(
      !(await readdir(outside)).includes('result.txt'),
      'an ancestor link must not redirect publication',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
