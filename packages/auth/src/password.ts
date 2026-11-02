import { argon2idAsync } from '@noble/hashes/argon2.js';
import { assert } from '@praxis/contracts';
import { randomBytes } from 'node:crypto';
import { equal } from './secrets.ts';

export const argonOptions = { t: 2, m: 19456, p: 1, dkLen: 32 } as const;

export async function hashPassword(password: string): Promise<string> {
  assert(
    password.length >= 12 && Buffer.byteLength(password) <= 1024,
    'INVALID_PASSWORD',
    '密码长度须为 12–1024 字节。',
  );
  const salt = randomBytes(16);
  const derived = await argon2idAsync(password, salt, argonOptions);
  return `$argon2id$v=19$m=19456,t=2,p=1$${salt.toString('base64')}$${Buffer.from(derived).toString('base64')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (Buffer.byteLength(password) > 1024) return false;
  const parts = encoded.split('$');
  if (
    parts.length !== 6 ||
    parts[1] !== 'argon2id' ||
    parts[2] !== 'v=19' ||
    parts[3] !== 'm=19456,t=2,p=1'
  )
    return false;
  const computed = await argon2idAsync(password, Buffer.from(parts[4]!, 'base64'), argonOptions);
  return equal(Buffer.from(computed).toString('base64'), parts[5]!);
}
