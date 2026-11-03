import { SessionStore } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('real SQLite capacity failure preserves its cause, rolls back facts and publishes nothing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-storage-capacity-'));
  const filename = path.join(root, 'sessions.sqlite');
  let store = new SessionStore(filename);
  try {
    const session = store.create('capacity-fixture', 'chat');
    const before = store.events(session.id);
    const notifications: unknown[] = [];
    store.on('event', (event) => notifications.push(event));
    const pages = Number(store.db.prepare('PRAGMA page_count').get()?.page_count);
    assert(Number.isSafeInteger(pages) && pages > 0);
    // Exercise SQLite's real SQLITE_FULL path without filling the user's filesystem.
    store.db.exec(`PRAGMA max_page_count=${pages}`);
    assert.throws(
      () =>
        store.transaction(() => {
          store.append(session.id, 'capacity/before-failure', {});
          store.append(session.id, 'capacity/too-large', { text: 'x'.repeat(128 * 1024) });
        }),
      { errcode: 13 },
    );
    assert.deepEqual(store.events(session.id), before);
    assert.deepEqual(notifications, []);
    assert.equal(store.get(session.id).latestSeq, session.latestSeq);
    store.db.exec(`PRAGMA max_page_count=${pages + 512}`);
    store.append(session.id, 'capacity/recovered', { text: 'x'.repeat(32 * 1024) });
    assert.equal(notifications.length, 1);
    store.close();
    store = new SessionStore(filename);
    assert.equal(store.latestEvent(session.id, 'capacity/recovered')?.seq, session.latestSeq + 1);
    assert.equal(store.db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
