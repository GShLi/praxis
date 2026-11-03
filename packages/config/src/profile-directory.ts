import { assert } from '@praxis/contracts';
import { randomUUID } from 'node:crypto';
import { lstat, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { exists, readProfileBinding } from './profile-binding.ts';
import { profilePaths, serverOrigin, type ProfileIdentity } from './profile-paths.ts';

export async function resolveProfileDirectory(base: string, identity: ProfileIdentity) {
  const paths = profilePaths(base, identity);
  if (!(await exists(path.join(paths.legacy, 'sessions.sqlite')))) return paths.current;
  const previous = await readProfileBinding(paths.legacy);
  assert(
    previous,
    'PROFILE_BINDING_REQUIRED',
    '发现未标明 Praxis 服务来源的旧数据。请关闭客户端，确认原服务地址后执行 data bind-legacy --confirm 原服务地址（桌面添加 --client desktop）。旧数据未修改。',
  );
  assert(
    previous.userId === paths.binding.userId && previous.clientKind === paths.binding.clientKind,
    'PROFILE_BINDING_INVALID',
    '旧账号来源标记与目录不一致。',
  );
  return previous.serverUrl === paths.binding.serverUrl ? paths.legacy : paths.current;
}

/** Local maintenance only: caller authenticates the identity and owns the legacy writer lease. */
export async function bindLegacyProfile(
  base: string,
  identity: ProfileIdentity,
  confirmation: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const paths = profilePaths(base, identity);
  assert(
    serverOrigin(confirmation) === paths.binding.serverUrl,
    'PROFILE_CONFIRM_REQUIRED',
    '请确认当前登录服务就是旧数据所属的原服务。',
  );
  const stat = await lstat(path.join(paths.legacy, 'sessions.sqlite'));
  assert(
    stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1,
    'PROFILE_PATH',
    '旧数据库不是独占普通文件。',
  );
  const previous = await readProfileBinding(paths.legacy);
  if (previous) {
    assert(
      JSON.stringify(previous) === JSON.stringify(paths.binding),
      'PROFILE_ALREADY_BOUND',
      '旧数据已经绑定其他服务，不能重新分配。',
    );
    return { directory: paths.legacy, binding: previous };
  }
  assert(
    !(await exists(path.join(paths.current, 'sessions.sqlite'))),
    'PROFILE_CONFLICT',
    '当前服务已有独立数据，不能自动合并旧目录。',
  );
  const temporary = path.join(paths.legacy, `.profile-origin-${randomUUID()}.tmp`);
  try {
    signal.throwIfAborted();
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify(paths.binding));
      await file.sync();
    } finally {
      await file.close();
    }
    signal.throwIfAborted();
    await rename(temporary, path.join(paths.legacy, 'profile-origin.json'));
    return { directory: paths.legacy, binding: paths.binding };
  } finally {
    await rm(temporary, { force: true });
  }
}
