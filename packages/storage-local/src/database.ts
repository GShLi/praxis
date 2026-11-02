import { assert } from '@praxis/contracts';
import { chmodSync, closeSync, constants, lstatSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Row } from './types.ts';
export function openDatabase(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (path !== ':memory:') {
    const fd = openSync(
      path,
      constants.O_CREAT | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    closeSync(fd);
    assert(
      lstatSync(path).isFile() && lstatSync(path).nlink === 1,
      'STORAGE_PATH_UNSAFE',
      '数据库路径不是独占普通文件。',
    );
    chmodSync(path, 0o600);
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const version = (db.prepare('PRAGMA user_version').get() as Row).user_version;
  assert(
    version === 0 || version === 1 || version === 2,
    'STORAGE_VERSION_UNSUPPORTED',
    '数据库版本比程序新，请升级程序。',
  );
  db.exec(`
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, owner TEXT NOT NULL, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, seq INTEGER NOT NULL, document TEXT NOT NULL, PRIMARY KEY(session_id,seq));
      CREATE TABLE IF NOT EXISTS inputs(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, request_id TEXT NOT NULL, digest TEXT NOT NULL, document TEXT NOT NULL, state TEXT NOT NULL, accepted_seq INTEGER NOT NULL, UNIQUE(session_id,request_id));
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS contexts(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, version INTEGER NOT NULL, document TEXT NOT NULL, PRIMARY KEY(session_id,version));
      CREATE TABLE IF NOT EXISTS checkpoints(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, seq INTEGER NOT NULL, document TEXT NOT NULL, PRIMARY KEY(session_id,seq));
      CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, kind TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, request_id TEXT NOT NULL, digest TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(session_id,request_id));
      CREATE TABLE IF NOT EXISTS maintenance_operations(id TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL, document TEXT NOT NULL);
      PRAGMA user_version=2;
    `);
  return db;
}
