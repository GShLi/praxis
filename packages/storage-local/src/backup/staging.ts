import { assert, PraxisError } from '@praxis/contracts';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { backupIdentitySchema, backupManifestSchema, type BackupIdentity } from './schema.ts';
import { hashOrCopy, readManifest } from './files.ts';
import { databaseWorker } from './worker.ts';

export async function stageBackup(
  directory: string,
  rawIdentity: BackupIdentity,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const identity = backupIdentitySchema.parse(rawIdentity);
  let raw: unknown;
  try {
    raw = await readManifest(path.join(directory, 'manifest.json'));
  } catch (error) {
    if (error instanceof PraxisError) throw error;
    throw new PraxisError('BACKUP_MANIFEST', '无法读取备份清单。');
  }
  const parsed = backupManifestSchema.safeParse(raw);
  assert(parsed.success, 'BACKUP_VERSION', '备份格式或版本不受支持。');
  const manifest = parsed.data;
  assert(
    JSON.stringify(manifest.identity) === JSON.stringify(identity),
    'BACKUP_IDENTITY',
    '备份不属于当前账号、客户端或 Praxis 服务地址。',
  );
  const temporary = await mkdtemp(path.join(tmpdir(), 'praxis-backup-verify-'));
  try {
    await chmod(temporary, 0o700);
    const file = path.join(temporary, 'sessions.sqlite');
    const actual = await hashOrCopy(path.join(directory, 'sessions.sqlite'), signal, file);
    assert(
      actual.bytes === manifest.bytes && actual.sha256 === manifest.sha256,
      'BACKUP_DIGEST',
      '备份文件大小或摘要不匹配。',
    );
    const counts = await databaseWorker(
      { mode: 'inspect', source: file, owner: identity.ownerUserId },
      signal,
    );
    assert(
      JSON.stringify(counts) === JSON.stringify(manifest.counts),
      'BACKUP_CORRUPT',
      '备份记录数量与清单不一致。',
    );
    return { file, manifest, close: () => rm(temporary, { recursive: true, force: true }) };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
