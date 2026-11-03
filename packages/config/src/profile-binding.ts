import { assert, PraxisError } from '@praxis/contracts';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { serverOrigin, type ProfileIdentity } from './profile-paths.ts';

export async function exists(file: string) {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
export async function readProfileBinding(
  directory: string,
): Promise<(ProfileIdentity & { version: 1 }) | undefined> {
  const stat = await lstat(directory);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), 'PROFILE_PATH', '旧账号目录不可使用链接。');
  let file;
  try {
    file = await open(
      path.join(directory, 'profile-origin.json'),
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    const stat = await file.stat();
    assert(
      stat.isFile() && stat.nlink === 1 && stat.size <= 8192,
      'PROFILE_BINDING_INVALID',
      '旧账号来源标记无效。',
    );
    let raw: unknown;
    try {
      raw = JSON.parse(await file.readFile('utf8'));
    } catch {
      throw new PraxisError('PROFILE_BINDING_INVALID', '旧账号来源标记无法读取，请检查原文件。');
    }
    assert(
      raw && typeof raw === 'object' && !Array.isArray(raw),
      'PROFILE_BINDING_INVALID',
      '旧账号来源标记无效。',
    );
    const value = raw as Record<string, unknown>;
    assert(
      value.version === 1 &&
        typeof value.userId === 'string' &&
        (value.clientKind === 'cli' || value.clientKind === 'desktop') &&
        typeof value.serverUrl === 'string' &&
        serverOrigin(value.serverUrl) === value.serverUrl,
      'PROFILE_BINDING_INVALID',
      '旧账号来源标记无效。',
    );
    return {
      version: 1,
      userId: value.userId,
      clientKind: value.clientKind,
      serverUrl: value.serverUrl,
    };
  } finally {
    await file.close();
  }
}
