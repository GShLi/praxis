import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { SessionStore } from '@praxis/storage-local';
import { constants } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { windowsFlushGuard } from './backup-flush-fixture.ts';

interface WorkerResult {
  ok: boolean;
  counts?: { sessions: number };
  error?: { code: string; safeMessage: string };
  probe: { attempts: number; flags: number; closed: boolean };
}

async function snapshotWorker(root: string, source: string, failFlush: boolean) {
  const entry = path.join(root, 'backup-worker.mjs');
  await build({
    entryPoints: ['packages/storage-local/src/backup/worker-main.ts'],
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    banner: { js: windowsFlushGuard },
  });
  const worker = new Worker(entry, {
    workerData: {
      input: {
        mode: 'snapshot',
        source,
        destination: path.join(root, 'copy.sqlite'),
        owner: 'alice',
      },
      failFlush,
    },
  });
  try {
    return await new Promise<WorkerResult>((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', (code) =>
        reject(new Error(`Backup worker exited before reply: ${code}`)),
      );
    });
  } finally {
    await worker.terminate();
  }
}

for (const failFlush of [false, true]) {
  test(`snapshot flush ${failFlush ? 'failure stays fatal, closed and sanitized' : 'uses a writable handle and preserves database contents'}`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'praxis-backup-flush-'));
    const source = path.join(root, 'source.sqlite');
    const store = new SessionStore(source);
    try {
      store.create('alice', 'chat');
      const result = await snapshotWorker(root, source, failFlush);
      assert.equal(result.probe.attempts, 1, 'must flush before reporting success');
      assert.equal(result.probe.closed, true, 'flush descriptor must close even on failure');
      assert(result.probe.flags & (constants.O_WRONLY | constants.O_RDWR));
      assert.equal(result.probe.flags & constants.O_TRUNC, 0, 'must not truncate the snapshot');
      assert.equal(result.probe.flags & (constants.O_NOFOLLOW ?? 0), constants.O_NOFOLLOW ?? 0);
      if (failFlush) {
        assert.equal(result.ok, false);
        assert.equal(result.error?.code, 'INTERNAL_ERROR');
        assert.doesNotMatch(
          JSON.stringify(result.error),
          /private snapshot|injected disk|EIO|cause/,
        );
      } else {
        assert.equal(result.ok, true);
        assert.equal(result.counts?.sessions, 1);
        const copy = new DatabaseSync(path.join(root, 'copy.sqlite'), { readOnly: true });
        try {
          assert.equal(copy.prepare('SELECT count(*) AS count FROM sessions').get()?.count, 1);
          assert.equal(copy.prepare('PRAGMA quick_check').get()?.quick_check, 'ok');
        } finally {
          copy.close();
        }
      }
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}
