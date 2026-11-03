import { SessionStore } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

test('unsupported databases close the failed connection without changing journal mode or user data', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-storage-open-'));
  const filename = path.join(root, 'sessions.sqlite'),
    source = new DatabaseSync(filename);
  source.exec(
    "PRAGMA user_version=999; CREATE TABLE future_data(value TEXT); INSERT INTO future_data VALUES ('preserve');",
  );
  source.close();
  let closed = 0;
  const original = DatabaseSync.prototype.close;
  const mocked = t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
    closed++;
    return original.call(this);
  });
  try {
    assert.throws(() => new SessionStore(filename), { code: 'STORAGE_VERSION_UNSUPPORTED' });
    assert.equal(closed, 1);
    const check = new DatabaseSync(filename);
    try {
      assert.equal(check.prepare('PRAGMA journal_mode').get()?.journal_mode, 'delete');
      assert.equal(check.prepare('PRAGMA user_version').get()?.user_version, 999);
      assert.equal(check.prepare('SELECT value FROM future_data').get()?.value, 'preserve');
    } finally {
      check.close();
    }
  } finally {
    mocked.mock.restore();
    await rm(root, { recursive: true, force: true });
  }
});

test('a schema initialization failure rolls back newly created tables and preserves the original version', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-storage-rollback-'));
  const filename = path.join(root, 'sessions.sqlite'),
    source = new DatabaseSync(filename);
  source.exec(
    'PRAGMA user_version=1; CREATE TABLE seed(value TEXT); CREATE INDEX contexts ON seed(value);',
  );
  source.close();
  try {
    assert.throws(() => new SessionStore(filename), /contexts/);
    const check = new DatabaseSync(filename);
    try {
      assert.deepEqual(
        check
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
          .map((row) => row.name),
        ['seed'],
      );
      assert.equal(check.prepare('PRAGMA user_version').get()?.user_version, 1);
    } finally {
      check.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
