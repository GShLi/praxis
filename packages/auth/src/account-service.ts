import { assert } from '@praxis/contracts';
import type { ServerDatabase } from '@praxis/storage-server';
import { randomUUID } from 'node:crypto';
import { recordAudit } from './audit.ts';
import { requireScope } from './authorization.ts';
import type { Identity, Scope } from './identity.ts';
import { digest, randomSecret } from './secrets.ts';
export class AccountService {
  constructor(private database: ServerDatabase) {}
  async createApiKey(identity: Identity, name: string, requested: Scope[], days: number) {
    requireScope(identity, 'keys:write');
    assert(
      requested.every((scope) => identity.scopes.includes(scope)),
      'FORBIDDEN',
      '不能授予超出当前身份的权限。',
    );
    const id = randomUUID(),
      secret = randomSecret();
    const expiresAt = new Date(Date.now() + days * 86400_000);
    await this.database.transaction(async (sql) => {
      await sql.query(
        'INSERT INTO api_keys(id,user_id,name,secret_hash,scopes,expires_at) VALUES($1,$2,$3,$4,$5,$6)',
        [id, identity.userId, name, digest(secret), JSON.stringify(requested), expiresAt],
      );
      await recordAudit(sql, identity.userId, 'api-key/create', id);
    });
    return { id, key: `pxk_.${id}.${secret}`, expiresAt: expiresAt.toISOString() };
  }

  async listApiKeys(identity: Identity) {
    requireScope(identity, 'keys:write');
    return (
      await this.database.query(
        'SELECT id,name,scopes,expires_at,revoked_at,last_used_at FROM api_keys WHERE user_id=$1',
        [identity.userId],
      )
    ).rows;
  }
  async revokeApiKey(identity: Identity, id: string) {
    requireScope(identity, 'keys:write');
    await this.database.query('UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND user_id=$2', [
      id,
      identity.userId,
    ]);
  }
  async profile(identity: Identity, csrfToken?: string) {
    requireScope(identity, 'profile:read');
    if (identity.kind !== 'web') csrfToken = undefined;
    else if (!csrfToken || digest(csrfToken) !== identity.csrfHash) {
      csrfToken = randomSecret();
      await this.database.query('UPDATE auth_sessions SET csrf_hash=$1 WHERE id=$2', [
        digest(csrfToken),
        identity.sessionId,
      ]);
    }
    return {
      id: identity.userId,
      username: identity.username,
      scopes: identity.scopes,
      ...(csrfToken ? { csrfToken } : {}),
    };
  }
}
