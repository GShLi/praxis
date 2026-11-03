import { assert } from '@praxis/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../database.ts';
import { backupCountsSchema } from './schema.ts';
import { inspectRecords } from './records.ts';

export const backupTables = [
  'sessions',
  'events',
  'inputs',
  'messages',
  'contexts',
  'checkpoints',
  'artifacts',
  'requests',
  'maintenance_operations',
] as const;
const schemaQuery =
  "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name";
/** Reject executable schema additions before reading application rows from an imported database. */
export function inspectDatabase(db: DatabaseSync, owner: string) {
  db.exec('PRAGMA trusted_schema=OFF; PRAGMA cache_size=-16384;');
  assert(
    db.prepare('PRAGMA user_version').get()?.user_version === 2,
    'BACKUP_VERSION',
    '备份数据库版本不受支持。',
  );
  validateSchema(db);
  for (const table of ['sessions', 'maintenance_operations'])
    assert(
      !db.prepare(`SELECT 1 FROM ${table} WHERE owner<>? LIMIT 1`).get(owner),
      'BACKUP_IDENTITY',
      '数据库包含其他账号的数据。',
    );
  const counts: Record<string, number> = {};
  for (const table of backupTables) {
    counts[table] = Number(db.prepare(`SELECT count(*) AS total FROM ${table}`).get()?.total);
    if (table !== 'artifacts' && table !== 'requests')
      assert(
        !db
          .prepare(
            `SELECT 1 FROM ${table} WHERE CASE WHEN json_valid(document) THEN json_type(document) END IS NOT 'object' LIMIT 1`,
          )
          .get(),
        'BACKUP_CORRUPT',
        '数据库包含无效的会话记录。',
      );
  }
  assert(
    !db
      .prepare(
        "SELECT 1 FROM requests WHERE CASE WHEN json_valid(result) THEN json_type(result) END IS NOT 'object' LIMIT 1",
      )
      .get(),
    'BACKUP_CORRUPT',
    '数据库包含无效的请求回执。',
  );
  assert(
    !db
      .prepare(
        "SELECT 1 FROM sessions WHERE json_extract(document,'$.ownerUserId') IS NOT owner OR json_extract(document,'$.id') IS NOT id LIMIT 1",
      )
      .get(),
    'BACKUP_IDENTITY',
    '会话身份与数据库索引不一致。',
  );
  inspectRecords(db);
  return backupCountsSchema.parse(counts);
}

function validateSchema(db: DatabaseSync) {
  const expected = openDatabase(':memory:');
  try {
    assert(
      JSON.stringify(db.prepare(schemaQuery).all()) ===
        JSON.stringify(expected.prepare(schemaQuery).all()),
      'BACKUP_SCHEMA',
      '备份数据库结构不匹配。',
    );
  } finally {
    expected.close();
  }
  assert(
    db.prepare('PRAGMA quick_check').get()?.quick_check === 'ok' &&
      db.prepare('PRAGMA foreign_key_check').all().length === 0,
    'BACKUP_CORRUPT',
    '备份数据库完整性校验失败。',
  );
}
