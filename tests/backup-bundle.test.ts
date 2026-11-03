import { build } from 'esbuild';
import { SessionStore } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

test('packaged backup code finds its fixed worker bundle without a TypeScript source loader', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-backup-bundle-'));
  const file = path.join(root, 'sessions.sqlite'),
    store = new SessionStore(file);
  try {
    store.create('alice', 'chat');
    const options = {
      bundle: true,
      platform: 'node' as const,
      format: 'esm' as const,
      target: 'node22',
    };
    await build({
      ...options,
      entryPoints: ['packages/storage-local/src/backup/worker-main.ts'],
      outfile: path.join(root, 'backup-worker.mjs'),
    });
    await build({
      ...options,
      stdin: {
        contents: `import {createLocalBackup} from '@praxis/storage-local/backup';
      console.log(JSON.stringify(await createLocalBackup(process.argv[2],process.argv[3],
      {ownerUserId:'alice',clientKind:'cli',serverUrl:'https://praxis.example'},AbortSignal.timeout(10000))));`,
        resolveDir: process.cwd(),
        loader: 'ts',
      },
      outfile: path.join(root, 'main.mjs'),
    });
    const result = await promisify(execFile)(
      process.execPath,
      [path.join(root, 'main.mjs'), file, root],
      { timeout: 15000 },
    );
    assert.equal(JSON.parse(result.stdout).manifest.counts.sessions, 1);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
