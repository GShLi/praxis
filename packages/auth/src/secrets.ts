import { assert, PraxisError } from '@praxis/contracts';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export const digest = (s: string) => createHash('sha256').update(s).digest('hex');

export const randomSecret = () => randomBytes(32).toString('base64url');

export const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export interface Encrypted {
  version: string;
  nonce: string;
  ciphertext: string;
  tag: string;
}

export class SecretCipher {
  constructor(
    private keys: Map<string, Buffer>,
    readonly activeVersion: string,
  ) {
    assert(
      keys.has(activeVersion) && [...keys.values()].every((key) => key.length === 32),
      'MASTER_KEY_INVALID',
      '服务加密密钥必须为 32 字节。',
    );
  }
  encrypt(secret: string, owner: string, resource: string, revision: number): Encrypted {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.activeVersion)!, nonce);
    cipher.setAAD(Buffer.from(JSON.stringify([owner, resource, revision])));
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return {
      version: this.activeVersion,
      nonce: nonce.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    };
  }
  decrypt(value: Encrypted, owner: string, resource: string, revision: number) {
    const key = this.keys.get(value.version);
    assert(key, 'CREDENTIAL_UNAVAILABLE', '此凭据的解密密钥版本不可用。');
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.nonce, 'base64'));
      decipher.setAAD(Buffer.from(JSON.stringify([owner, resource, revision])));
      decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(value.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new PraxisError('CREDENTIAL_UNAVAILABLE', '凭据校验失败。');
    }
  }
}
