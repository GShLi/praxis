import { WorkspaceFiles } from '@praxis/tools/files';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('continuation pages retain at most 32 cursors and honor cancellation without consuming a cursor', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-pagination-'));
  const files = await WorkspaceFiles.open(root, () => 'unused');
  const input = { path: '.', includeHidden: false, limit: 1 };
  try {
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        writeFile(path.join(root, `${String(i).padStart(2, '0')}.txt`), ''),
      ),
    );
    let page = await files.list(input);
    const first = page.nextCursor;
    assert(first);
    for (let i = 0; i < 33; i++) {
      assert(page.nextCursor);
      page = await files.list({ ...input, cursor: page.nextCursor });
    }
    await assert.rejects(files.list({ ...input, cursor: first }), { code: 'CURSOR_EXPIRED' });
    assert(page.nextCursor);
    await assert.rejects(files.list({ ...input, cursor: page.nextCursor }, AbortSignal.abort()), {
      name: 'AbortError',
    });
    const next = await files.list({ ...input, cursor: page.nextCursor });
    assert.equal(next.entries[0]?.name, '34.txt');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
