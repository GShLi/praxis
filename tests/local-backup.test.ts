import { SessionStore, uuid } from '@praxis/storage-local';
import {
  createLocalBackup,
  inspectLocalBackup,
  restoreLocalBackup,
} from '@praxis/storage-local/backup';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, appendFile, writeFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('consistent local backups preserve full history and artifacts, restore transactionally and retain a rollback snapshot', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-backup-'));
  const file = path.join(root, 'sessions.sqlite');
  const identity = {
    ownerUserId: 'alice',
    clientKind: 'cli' as const,
    serverUrl: 'https://praxis.example',
  };
  let store = new SessionStore(file);
  try {
    const session = store.create('alice', 'agent', root);
    const messageId = uuid();
    store.message(session.id, { id: messageId, role: 'user', content: 'Build a page' });
    const artifact = store.artifact(session.id, 'file-content', '<h1>Hello World</h1>');
    store.commitContext(
      session.id,
      0,
      { id: uuid(), role: 'user', content: 'summary' },
      messageId,
      [messageId],
    );
    store.checkpoint(session.id);
    const saved = await createLocalBackup(file, root, identity, AbortSignal.timeout(10000));
    const manifest = await inspectLocalBackup(
      saved.directory,
      identity,
      AbortSignal.timeout(10000),
    );
    assert.equal(manifest.counts.sessions, 1);
    assert.equal(manifest.counts.contexts, 1);
    assert.equal(manifest.counts.checkpoints, 1);
    store.message(session.id, { id: uuid(), role: 'assistant', content: 'after backup' });
    store.close();
    const restored = await restoreLocalBackup(
      file,
      saved.directory,
      identity,
      AbortSignal.timeout(10000),
      saved.manifest.sha256,
    );
    store = new SessionStore(file);
    store.recover();
    assert.equal(store.messages(session.id).length, 1);
    assert.equal(store.readArtifact(session.id, artifact).content, '<h1>Hello World</h1>');
    assert.equal(store.context(session.id).version, 1);
    const previous = await inspectLocalBackup(
      restored.rollbackDirectory,
      identity,
      AbortSignal.timeout(10000),
    );
    assert.equal(previous.counts.messages, 2);
    const text = await readFile(path.join(saved.directory, 'manifest.json'), 'utf8');
    assert.ok(!text.includes('Build a page'));
  } finally {
    if (store.db.isOpen) store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('imported schema, version and invalid records are refused even when their manifest digest is recomputed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-backup-schema-'));
  const file = path.join(root, 'sessions.sqlite'),
    store = new SessionStore(file);
  const identity = {
    ownerUserId: 'alice',
    clientKind: 'cli' as const,
    serverUrl: 'https://praxis.example',
  };
  try {
    store.create('alice', 'chat');
    for (const [sql, code] of [
      [
        'CREATE TRIGGER unexpected AFTER INSERT ON messages BEGIN DELETE FROM sessions; END',
        'BACKUP_SCHEMA',
      ],
      ['PRAGMA user_version=999', 'BACKUP_VERSION'],
      [
        "UPDATE sessions SET document=json_set(document,'$.permission.mode','danger-full-access')",
        'BACKUP_CORRUPT',
      ],
      ["UPDATE sessions SET document=json_set(document,'$.latestSeq',500)", 'BACKUP_CORRUPT'],
      ["UPDATE events SET document=json_set(document,'$.seq',500)", 'BACKUP_CORRUPT'],
    ] as const) {
      const saved = await createLocalBackup(file, root, identity, AbortSignal.timeout(10000));
      const snapshot = path.join(saved.directory, 'sessions.sqlite');
      const modified = new DatabaseSync(snapshot);
      try {
        modified.exec(sql);
      } finally {
        modified.close();
      }
      const data = await readFile(snapshot);
      const manifest = {
        ...saved.manifest,
        bytes: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
      };
      await writeFile(path.join(saved.directory, 'manifest.json'), JSON.stringify(manifest));
      await assert.rejects(
        restoreLocalBackup(
          file,
          saved.directory,
          identity,
          AbortSignal.timeout(10000),
          manifest.sha256,
        ),
        { code },
      );
      assert.equal(store.list('alice').length, 1);
    }
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('cancelling backup work closes its worker and publishes no partial backup', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-backup-cancel-'));
  const file = path.join(root, 'sessions.sqlite'),
    store = new SessionStore(file);
  const identity = {
    ownerUserId: 'alice',
    clientKind: 'cli' as const,
    serverUrl: 'https://praxis.example',
  };
  try {
    const session = store.create('alice', 'chat');
    store.artifact(session.id, 'fixture', 'x'.repeat(2 * 1024 * 1024));
    const scope = new AbortController();
    const cancelled = assert.rejects(createLocalBackup(file, root, identity, scope.signal));
    const timer = setTimeout(() => scope.abort(), 25);
    try {
      await cancelled;
    } finally {
      clearTimeout(timer);
    }
    assert.ok((await readdir(root)).every((name) => !name.includes('praxis-backup-')));
    assert.equal(store.list('alice').length, 1);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('restoring to a fresh profile leaves interrupted work suspended and never replays old tool calls', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-backup-recovery-'));
  const original = path.join(root, 'original.sqlite'),
    target = path.join(root, 'new-profile', 'sessions.sqlite');
  const store = new SessionStore(original);
  const identity = {
    ownerUserId: 'alice',
    clientKind: 'cli' as const,
    serverUrl: 'https://praxis.example',
  };
  try {
    const session = store.create('alice', 'agent', root);
    store.message(session.id, {
      id: uuid(),
      role: 'assistant',
      content: '',
      toolCalls: [
        { id: 'unfinished-call', name: 'write_file', arguments: '{"path":"missing.html"}' },
      ],
    });
    store.accept({ sessionId: session.id, requestId: uuid(), mode: 'queue', text: 'queued work' });
    store.update(session.id, { status: 'running' });
    const saved = await createLocalBackup(original, root, identity, AbortSignal.timeout(10000));
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
      assert.equal(restored.get(session.id).status, 'interrupted');
      assert.equal(restored.inputs(session.id, 'suspended').length, 1);
      assert.match(restored.messages(session.id).at(-1)?.content ?? '', /HOST_INTERRUPTED/);
      assert.ok(!(await readdir(root)).includes('missing.html'));
    } finally {
      restored.close();
    }
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('backup restoration rejects wrong identity and altered snapshots without changing the current database', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-backup-invalid-'));
  const file = path.join(root, 'sessions.sqlite');
  const identity = {
    ownerUserId: 'alice',
    clientKind: 'desktop' as const,
    serverUrl: 'https://praxis.example',
  };
  const store = new SessionStore(file);
  try {
    store.create('alice', 'chat');
    const saved = await createLocalBackup(file, root, identity, AbortSignal.timeout(10000));
    await assert.rejects(
      inspectLocalBackup(
        saved.directory,
        { ...identity, ownerUserId: 'bob' },
        AbortSignal.timeout(10000),
      ),
      { code: 'BACKUP_IDENTITY' },
    );
    await assert.rejects(
      inspectLocalBackup(
        saved.directory,
        { ...identity, serverUrl: 'https://other.example' },
        AbortSignal.timeout(10000),
      ),
      { code: 'BACKUP_IDENTITY' },
    );
    await appendFile(path.join(saved.directory, 'sessions.sqlite'), 'corrupt');
    await assert.rejects(
      restoreLocalBackup(
        file,
        saved.directory,
        identity,
        AbortSignal.timeout(10000),
        saved.manifest.sha256,
      ),
      { code: 'BACKUP_DIGEST' },
    );
    assert.equal(store.list('alice').length, 1);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
