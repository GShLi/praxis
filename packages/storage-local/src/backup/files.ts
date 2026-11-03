import { assert } from '@praxis/contracts';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, statfs } from 'node:fs/promises';
import { MAX_BACKUP_BYTES } from './schema.ts';

export async function hashOrCopy(source: string, signal: AbortSignal, destination?: string) {
  assert(!(await lstat(source)).isSymbolicLink(), 'BACKUP_PATH', '备份文件不能是符号链接。');
  const input = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let output: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const initial = await input.stat();
    assert(
      initial.isFile() && initial.size > 0 && initial.size <= MAX_BACKUP_BYTES,
      'BACKUP_LIMIT',
      '备份须为不超过 2 GiB 的普通数据库文件。',
    );
    if (destination) output = await open(destination, 'wx', 0o600);
    const digest = createHash('sha256'),
      buffer = Buffer.alloc(1024 * 1024);
    let bytes = 0;
    for (;;) {
      signal.throwIfAborted();
      const part = await input.read(buffer, 0, buffer.length, bytes);
      if (!part.bytesRead) break;
      bytes += part.bytesRead;
      assert(bytes <= MAX_BACKUP_BYTES, 'BACKUP_LIMIT', '备份文件超过限制。');
      const chunk = buffer.subarray(0, part.bytesRead);
      digest.update(chunk);
      if (output) await output.writeFile(chunk);
    }
    const after = await input.stat();
    assert(
      initial.size === bytes && after.size === bytes && initial.mtimeMs === after.mtimeMs,
      'BACKUP_CHANGED',
      '读取期间备份文件发生变化。',
    );
    await output?.sync();
    return { bytes, sha256: digest.digest('hex') };
  } finally {
    try {
      await output?.close();
    } finally {
      await input.close();
    }
  }
}

export async function readManifest(file: string) {
  assert(!(await lstat(file)).isSymbolicLink(), 'BACKUP_PATH', '备份清单不能是符号链接。');
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stats = await handle.stat();
    assert(stats.isFile() && stats.size <= 16384, 'BACKUP_LIMIT', '备份清单超过大小限制。');
    const buffer = Buffer.alloc(16385);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    assert(bytesRead <= 16384, 'BACKUP_LIMIT', '备份清单超过大小限制。');
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')) as unknown;
  } finally {
    await handle.close();
  }
}

export async function requireDiskSpace(directory: string, bytes: number) {
  const stats = await statfs(directory, { bigint: true });
  assert(
    stats.bavail * stats.bsize >= BigInt(bytes) * 3n + 16n * 1024n * 1024n,
    'BACKUP_DISK_FULL',
    '磁盘可用空间不足以安全备份和恢复。',
  );
}
