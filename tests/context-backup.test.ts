import { SessionStore } from '@praxis/storage-local';
import {
  createLocalBackup,
  inspectLocalBackup,
  restoreLocalBackup,
} from '@praxis/storage-local/backup';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { projectionFixture } from './fixtures/context-projection.ts';

const identity = {
  ownerUserId: 'owner',
  clientKind: 'cli' as const,
  serverUrl: 'https://praxis.example',
};
test('v3 backups retain tool projections, their artifacts and recovery checkpoints', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-view-backup-'));
  const file = path.join(root, 'sessions.sqlite');
  const f = projectionFixture(file);
  try {
    await f.build();
    f.store.checkpoint(f.session.id);
    const view = f.store.context(f.session.id);
    const saved = await createLocalBackup(file, root, identity, AbortSignal.timeout(10000));
    assert.equal(saved.manifest.storageVersion, 3);
    const target = path.join(root, 'restored.sqlite');
    await restoreLocalBackup(
      target,
      saved.directory,
      identity,
      AbortSignal.timeout(10000),
      saved.manifest.sha256,
    );
    const restored = new SessionStore(target);
    try {
      restored.recover();
      assert.deepEqual(restored.context(f.session.id), view);
      assert.deepEqual(restored.messages(f.session.id), f.store.messages(f.session.id));
      for (const output of view.toolOutputs!)
        assert.deepEqual(
          restored.readArtifact(f.session.id, output.artifactId),
          f.store.readArtifact(f.session.id, output.artifactId),
        );
    } finally {
      restored.close();
    }
    await writeFile(
      path.join(saved.directory, 'manifest.json'),
      JSON.stringify({ ...saved.manifest, storageVersion: 2 }),
    );
    await assert.rejects(
      inspectLocalBackup(saved.directory, identity, AbortSignal.timeout(10000)),
      { code: 'BACKUP_VERSION' },
    );
  } finally {
    f.store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy v2 databases upgrade without dropping history and their backups remain importable', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-v2-backup-'));
  const file = path.join(root, 'sessions.sqlite');
  const store = new SessionStore(file);
  const session = store.create('owner', 'chat');
  store.message(session.id, { id: 'original-input', role: 'user', content: 'legacy input' });
  store.close();
  const legacy = new DatabaseSync(file);
  legacy.exec('PRAGMA user_version=2');
  legacy.close();
  try {
    const saved = await createLocalBackup(file, root, identity, AbortSignal.timeout(10000));
    assert.equal(saved.manifest.storageVersion, 2);
    const upgraded = new SessionStore(file);
    try {
      assert.equal(upgraded.db.prepare('PRAGMA user_version').get()!.user_version, 3);
      assert.equal(upgraded.messages(session.id)[0]!.content, 'legacy input');
    } finally {
      upgraded.close();
    }
    await restoreLocalBackup(
      file,
      saved.directory,
      identity,
      AbortSignal.timeout(10000),
      saved.manifest.sha256,
    );
    const restored = new SessionStore(file);
    try {
      assert.equal(restored.messages(session.id)[0]!.content, 'legacy input');
      assert.equal(restored.db.prepare('PRAGMA user_version').get()!.user_version, 3);
    } finally {
      restored.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
