import { assert } from '@praxis/contracts';
import { createHash } from 'node:crypto';
import path from 'node:path';

export interface ProfileIdentity {
  userId: string;
  clientKind: 'cli' | 'desktop';
  serverUrl: string;
}
export function serverOrigin(raw: string) {
  const url = new URL(raw);
  assert(
    ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/',
    'INVALID_SERVER_URL',
    '服务地址须为来源 URL。',
  );
  return url.origin;
}
export function profilePaths(base: string, identity: ProfileIdentity) {
  assert(
    typeof identity.userId === 'string' &&
      identity.userId.length > 0 &&
      identity.userId.length <= 1024 &&
      ['cli', 'desktop'].includes(identity.clientKind),
    'PROFILE_IDENTITY',
    '本地账号身份无效。',
  );
  const binding = {
    version: 1 as const,
    userId: identity.userId,
    clientKind: identity.clientKind,
    serverUrl: serverOrigin(identity.serverUrl),
  };
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  const parent = path.join(base, identity.clientKind);
  return {
    binding,
    current: path.join(parent, 'servers', digest(binding.serverUrl), digest(binding.userId)),
    legacy: path.join(parent, digest(binding.userId)),
  };
}
