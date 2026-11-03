import { assert } from '@praxis/contracts';
import { constants } from 'node:fs';
import { lstat, mkdir, open, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';

const filename = /^diagnostics-(\d{13})-([a-f0-9-]{36})\.jsonl$/;
export async function logFiles(directory: string) {
  let names: string[];
  try {
    const stat = await lstat(directory);
    assert(
      stat.isDirectory() && !stat.isSymbolicLink(),
      'DIAGNOSTICS_PATH',
      '诊断目录不是普通目录。',
    );
    names = [];
    const entries = await opendir(directory);
    for await (const entry of entries) {
      assert(names.length < 1000, 'DIAGNOSTICS_LIMIT', '诊断目录项目过多。');
      names.push(entry.name);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return names
    .flatMap((name) => {
      const match = filename.exec(name);
      return match ? [{ name, file: path.join(directory, name), createdAt: Number(match[1]) }] : [];
    })
    .sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name));
}
export async function prepareDirectory(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  assert(
    stat.isDirectory() && !stat.isSymbolicLink(),
    'DIAGNOSTICS_PATH',
    '诊断目录不是普通目录。',
  );
  return realpath(directory);
}
export async function readLogTail(file: string, limit: number, signal: AbortSignal) {
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    signal.throwIfAborted();
    const stat = await handle.stat();
    assert(stat.isFile() && stat.nlink === 1, 'DIAGNOSTICS_PATH', '诊断文件不是独占普通文件。');
    const size = Math.min(limit, stat.size),
      offset = stat.size - size;
    const bytes = Buffer.alloc(size);
    let read = 0;
    while (read < size) {
      signal.throwIfAborted();
      const result = await handle.read(bytes, read, size - read, offset + read);
      if (!result.bytesRead) break;
      read += result.bytesRead;
    }
    const text = bytes.subarray(0, read).toString('utf8');
    return {
      text: offset ? (text.includes('\n') ? text.slice(text.indexOf('\n') + 1) : '') : text,
      bytesRead: read,
      truncated: offset > 0 || read !== size,
    };
  } finally {
    await handle.close();
  }
}
