import { assert } from '@praxis/contracts';
import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, open, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  backupIdentitySchema,
  backupManifestSchema,
  MAX_BACKUP_BYTES,
  type BackupIdentity,
} from './schema.ts';
import { hashOrCopy, requireDiskSpace } from './files.ts';
import { stageBackup } from './staging.ts';
import { databaseWorker } from './worker.ts';
import { BackupRestoreError } from './errors.ts';
import { openDatabase } from '../database.ts';

/** Snapshot export is consistent even with WAL writes; restore callers must hold the profile writer lease. */
export async function createLocalBackup(
  database: string,
  parent: string,
  rawIdentity: BackupIdentity,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const identity = backupIdentitySchema.parse(rawIdentity),
    source = await lstat(database);
  assert(
    source.isFile() && !source.isSymbolicLink() && source.size <= MAX_BACKUP_BYTES,
    'BACKUP_PATH',
    '数据库路径不可备份。',
  );
  const target = await realpath(parent);
  assert((await lstat(target)).isDirectory(), 'BACKUP_PATH', '请选择备份父目录。');
  await requireDiskSpace(target, source.size);
  const temporary = await mkdtemp(path.join(target, '.praxis-backup-'));
  try {
    await chmod(temporary, 0o700);
    const output = path.join(temporary, 'sessions.sqlite');
    const counts = await databaseWorker(
      {
        mode: 'snapshot',
        source: path.resolve(database),
        destination: output,
        owner: identity.ownerUserId,
      },
      signal,
    );
    const digest = await hashOrCopy(output, signal);
    const manifest = backupManifestSchema.parse({
      format: 'praxis-local-backup',
      version: 1,
      storageVersion: 2,
      identity,
      createdAt: new Date().toISOString(),
      ...digest,
      counts,
    });
    const file = await open(path.join(temporary, 'manifest.json'), 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify(manifest, null, 2));
      await file.sync();
    } finally {
      await file.close();
    }
    signal.throwIfAborted();
    const directory = path.join(target, `praxis-backup-${Date.now()}-${randomUUID()}`);
    await rename(temporary, directory);
    return { directory, manifest };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function inspectLocalBackup(
  directory: string,
  identity: BackupIdentity,
  signal: AbortSignal,
) {
  const staged = await stageBackup(directory, identity, signal);
  try {
    return staged.manifest;
  } finally {
    await staged.close();
  }
}

export async function restoreLocalBackup(
  database: string,
  directory: string,
  identity: BackupIdentity,
  signal: AbortSignal,
  expectedDigest: string,
) {
  const staged = await stageBackup(directory, identity, signal);
  try {
    assert(
      staged.manifest.sha256 === expectedDigest,
      'BACKUP_CHANGED',
      '备份与已确认的摘要不同，请重新检查。',
    );
    try {
      await lstat(database);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      openDatabase(database).close();
    }
    const rollbackParent = path.join(path.dirname(path.resolve(database)), 'recovery-backups');
    await mkdir(rollbackParent, { recursive: true, mode: 0o700 });
    await requireDiskSpace(rollbackParent, staged.manifest.bytes);
    const rollback = await createLocalBackup(database, rollbackParent, identity, signal);
    signal.throwIfAborted();
    try {
      await databaseWorker(
        {
          mode: 'restore',
          source: staged.file,
          destination: path.resolve(database),
          owner: identity.ownerUserId,
        },
        signal,
      );
    } catch {
      throw new BackupRestoreError(rollback.directory);
    }
    return { rollbackDirectory: rollback.directory, restored: staged.manifest };
  } finally {
    await staged.close();
  }
}
