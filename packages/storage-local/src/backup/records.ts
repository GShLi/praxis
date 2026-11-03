import { assert } from '@praxis/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { recordSchemas } from './record-schema.ts';
import { contextViewSchema } from '../context-schema.ts';
import { validateContextReferences } from '../context-references.ts';

export function inspectRecords(db: DatabaseSync) {
  for (const [table, schema] of Object.entries(recordSchemas)) {
    assert(
      !db.prepare(`SELECT 1 FROM ${table} WHERE rowid<=0 LIMIT 1`).get(),
      'BACKUP_CORRUPT',
      '备份包含无效的记录序号。',
    );
    assert(
      !db
        .prepare(`SELECT 1 FROM ${table} WHERE length(CAST(document AS BLOB))>16777216 LIMIT 1`)
        .get(),
      'BACKUP_LIMIT',
      '备份中单条记录超过 16 MiB。',
    );
    // One bounded row at a time; do not retain an iterator whose SQLite statement can be GC'd.
    const statement = db.prepare(
      `SELECT rowid,document${table === 'contexts' ? ',session_id' : ''} FROM ${table} WHERE rowid>? ORDER BY rowid LIMIT 1`,
    );
    let cursor = 0;
    for (let row = statement.get(cursor); row; row = statement.get(cursor)) {
      const parsed = schema.safeParse(JSON.parse(String(row.document)));
      assert(parsed.success, 'BACKUP_CORRUPT', '备份包含不受支持的会话记录。');
      if (table === 'contexts')
        validateContextReferences(db, String(row.session_id), contextViewSchema.parse(parsed.data));
      cursor = Number(row.rowid);
    }
  }
  for (const [table, predicate] of consistencyRules)
    assert(
      !db.prepare(`SELECT 1 FROM ${table} WHERE ${predicate} LIMIT 1`).get(),
      'BACKUP_CORRUPT',
      '备份记录与索引或关联不一致。',
    );
}

// These are fixed storage expressions, never supplied by a backup or caller.
const consistencyRules = [
  [
    'sessions',
    "json_extract(document,'$.latestSeq') IS NOT (SELECT coalesce(max(seq),0) FROM events WHERE session_id=sessions.id)",
  ],
  [
    'events',
    "json_extract(document,'$.sessionId') IS NOT session_id OR json_extract(document,'$.seq') IS NOT seq",
  ],
  [
    'messages',
    "json_extract(document,'$.id') IS NOT id OR NOT EXISTS (SELECT 1 FROM events WHERE session_id=messages.session_id AND seq=messages.ordinal)",
  ],
  [
    'inputs',
    "json_extract(document,'$.id') IS NOT id OR json_extract(document,'$.sessionId') IS NOT session_id OR json_extract(document,'$.requestId') IS NOT request_id OR state NOT IN ('pending','claimed','suspended','cancelled')",
  ],
  [
    'contexts',
    "json_extract(document,'$.version') IS NOT version OR (json_extract(document,'$.throughMessageId') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM messages WHERE session_id=contexts.session_id AND id=json_extract(contexts.document,'$.throughMessageId')))",
  ],
  [
    'checkpoints',
    "json_extract(document,'$.session.id') IS NOT session_id OR json_extract(document,'$.throughSeq') IS NOT seq OR json_extract(document,'$.session.latestSeq') IS NOT seq OR json_extract(document,'$.session.ownerUserId') IS NOT (SELECT owner FROM sessions WHERE id=checkpoints.session_id) OR seq>(SELECT max(seq) FROM events WHERE session_id=checkpoints.session_id)",
  ],
  [
    'maintenance_operations',
    "state NOT IN ('running','succeeded','failed','cancelled','interrupted')",
  ],
] as const;
