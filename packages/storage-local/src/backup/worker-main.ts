import { assert, safeError } from '@praxis/contracts';
import { DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';
import {
  chmodSync,
  closeSync,
  constants,
  lstatSync,
  openSync,
  fsyncSync,
  statfsSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { backupTables, inspectDatabase } from './inspection.ts';
import { databaseTaskSchema, MAX_BACKUP_BYTES } from './schema.ts';

function databaseTask() {
  const input = databaseTaskSchema.parse(workerData.input);
  const source = new DatabaseSync(input.source, { readOnly: true, allowExtension: false });
  try {
    const counts = inspectDatabase(source, input.owner);
    const storageVersion = Number(source.prepare('PRAGMA user_version').get()?.user_version);
    if (input.mode === 'inspect') return { counts, storageVersion };
    assert(input.destination, 'BACKUP_PATH', '缺少数据库目标路径。');
    if (input.mode === 'snapshot') {
      const bytes =
        Number(source.prepare('PRAGMA page_count').get()?.page_count) *
        Number(source.prepare('PRAGMA page_size').get()?.page_size);
      assert(bytes <= MAX_BACKUP_BYTES, 'BACKUP_LIMIT', '数据库超过 2 GiB 备份限制。');
      const space = statfsSync(dirname(input.destination), { bigint: true });
      assert(
        space.bavail * space.bsize >= BigInt(bytes) * 3n + 16777216n,
        'BACKUP_DISK_FULL',
        '备份磁盘空间不足。',
      );
      const fd = openSync(
        input.destination,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
      closeSync(fd);
      source.prepare('VACUUM INTO ?').run(input.destination);
      chmodSync(input.destination, 0o600);
      // Windows FlushFileBuffers requires write access; keep fsync mandatory without truncation.
      const output = openSync(input.destination, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0));
      try {
        fsyncSync(output);
      } finally {
        closeSync(output);
      }
      const copy = new DatabaseSync(input.destination, { readOnly: true, allowExtension: false });
      try {
        return {
          counts: inspectDatabase(copy, input.owner),
          storageVersion: Number(copy.prepare('PRAGMA user_version').get()?.user_version),
        };
      } finally {
        copy.close();
      }
    } else restoreRows(input.source, input.destination, input.owner);
    return { counts, storageVersion };
  } finally {
    source.close();
  }
}

function restoreRows(source: string, destination: string, owner: string) {
  const stat = lstatSync(destination);
  assert(
    stat.isFile() && stat.nlink === 1 && !stat.isSymbolicLink(),
    'BACKUP_PATH',
    '目标数据库不是独占普通文件。',
  );
  const db = new DatabaseSync(destination, { allowExtension: false });
  try {
    inspectDatabase(db, owner);
    db.exec(
      'PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;',
    );
    db.prepare('ATTACH DATABASE ? AS restored').run(source);
    db.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON;');
    try {
      for (const table of [...backupTables].reverse()) db.exec(`DELETE FROM main.${table}`);
      for (const table of backupTables)
        db.exec(`INSERT INTO main.${table} SELECT * FROM restored.${table} ORDER BY rowid`);
      assert(
        db.prepare('PRAGMA main.foreign_key_check').all().length === 0,
        'BACKUP_CORRUPT',
        '恢复数据的关联校验失败。',
      );
      db.exec('PRAGMA main.user_version=3; COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

try {
  parentPort?.postMessage({ ok: true, ...databaseTask() });
} catch (error) {
  parentPort?.postMessage({ ok: false, error: safeError(error) });
}
