import { assert } from '@praxis/contracts';
import type { ServerDatabase, SqlConnection } from '@praxis/storage-server';
import { randomUUID } from 'node:crypto';
import { recordAudit } from './audit.ts';
import type { Identity, Scope } from './identity.ts';
import { scopes } from './identity.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { ProviderService } from './provider-service.ts';
import { digest, equal, randomSecret, SecretCipher } from './secrets.ts';

export class AuthService {
  private providers: ProviderService;
  constructor(
    readonly database: ServerDatabase,
    readonly cipher: SecretCipher,
  ) {
    this.providers = new ProviderService(database, cipher);
  }

  async createUser(username: string, password: string, admin = false) {
    assert(/^[\p{L}\p{N}_.@-]{3,100}$/u.test(username), 'INVALID_ARGUMENT', '账号格式无效。');
    const encoded = await hashPassword(password);
    const id = randomUUID();
    await this.database.transaction(async (sql) => {
      await sql.query('INSERT INTO users(id,username,password_hash,admin) VALUES($1,$2,$3,$4)', [
        id,
        username.toLowerCase(),
        encoded,
        admin,
      ]);
      await recordAudit(sql, 'admin-cli', 'user/create', id);
    });
    return { id, username };
  }
  private async ticket(
    sql: SqlConnection,
    userId: string,
    kind: string,
    lifetime: number,
    allowed: Scope[],
    family: string,
    csrf?: string,
  ) {
    const token = randomSecret(),
      id = randomUUID();
    const expiresAt = new Date(Date.now() + lifetime);
    await sql.query(
      'INSERT INTO auth_sessions(id,user_id,token_hash,kind,scopes,expires_at,family,csrf_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        id,
        userId,
        digest(token),
        kind,
        JSON.stringify(allowed),
        expiresAt,
        family,
        csrf ? digest(csrf) : null,
      ],
    );
    return { token, expiresAt: expiresAt.toISOString(), id };
  }
  async login(username: string, password: string, kind: 'web' | 'client') {
    const user = (
      await this.database.query<{ id: string; password_hash: string; status: string }>(
        'SELECT id,password_hash,status FROM users WHERE username=$1',
        [username.toLowerCase()],
      )
    ).rows[0];
    const dummy =
      '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    const valid = await verifyPassword(password, user?.password_hash ?? dummy);
    assert(user?.status === 'active' && valid, 'AUTH_FAILED', '账号或密码不正确。');
    return this.database.transaction(async (sql) => {
      const family = randomUUID();
      const csrf = randomSecret();
      const access = await this.ticket(
        sql,
        user.id,
        kind === 'web' ? 'web' : 'access',
        15 * 60_000,
        [...scopes],
        family,
        kind === 'web' ? csrf : undefined,
      );
      const refresh = await this.ticket(
        sql,
        user.id,
        'refresh',
        30 * 86400_000,
        [...scopes],
        family,
      );
      await recordAudit(sql, user.id, 'auth/login', family);
      return {
        accessToken: access.token,
        refreshToken: refresh.token,
        expiresAt: access.expiresAt,
        csrfToken: csrf,
      };
    });
  }
  async authenticate(token: string): Promise<Identity> {
    assert(token.length <= 1024, 'UNAUTHENTICATED', '登录已失效。');
    if (token.startsWith('pxk_')) {
      const [, id, secret] = token.split('.');
      assert(id && secret, 'UNAUTHENTICATED', 'Praxis API Key 无效。');
      const row = (
        await this.database.query<{
          id: string;
          user_id: string;
          secret_hash: string;
          scopes: Scope[];
          username: string;
          admin: boolean;
        }>(
          "SELECT k.id,k.user_id,k.secret_hash,k.scopes,u.username,u.admin FROM api_keys k JOIN users u ON u.id=k.user_id WHERE k.id=$1 AND k.revoked_at IS NULL AND k.expires_at>now() AND u.status='active'",
          [id],
        )
      ).rows[0];
      assert(
        row && equal(row.secret_hash, digest(secret)),
        'UNAUTHENTICATED',
        'Praxis API Key 无效。',
      );
      await this.database.query('UPDATE api_keys SET last_used_at=now() WHERE id=$1', [id]);
      return {
        userId: row.user_id,
        sessionId: row.id,
        username: row.username,
        admin: row.admin,
        scopes: row.scopes,
        kind: 'api-key',
      };
    }
    const row = (
      await this.database.query<{
        id: string;
        user_id: string;
        kind: 'web' | 'access';
        scopes: Scope[];
        csrf_hash: string;
        username: string;
        admin: boolean;
      }>(
        "SELECT s.id,s.user_id,s.kind,s.scopes,s.csrf_hash,u.username,u.admin FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.kind IN ('web','access') AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status='active'",
        [digest(token)],
      )
    ).rows[0];
    assert(row, 'UNAUTHENTICATED', '登录已失效。');
    return {
      userId: row.user_id,
      sessionId: row.id,
      username: row.username,
      admin: row.admin,
      kind: row.kind,
      scopes: row.scopes,
      ...(row.csrf_hash ? { csrfHash: row.csrf_hash } : {}),
    };
  }
  require(identity: Identity, scope: Scope) {
    assert(identity.scopes.includes(scope), 'FORBIDDEN', '此凭据没有所需权限。');
  }
  async exchange(identity: Identity) {
    assert(identity.kind === 'api-key', 'FORBIDDEN', '此入口要求 Praxis API Key。');
    const access = await this.ticket(
      this.database,
      identity.userId,
      'access',
      15 * 60_000,
      identity.scopes,
      randomUUID(),
    );
    return { accessToken: access.token, expiresAt: access.expiresAt, userId: identity.userId };
  }
  async refresh(token: string, web: boolean) {
    // Return the rejection after COMMIT so reuse detection revokes the family durably.
    const result = await this.database.transaction(async (sql) => {
      const row = (
        await sql.query<{
          id: string;
          user_id: string;
          scopes: Scope[];
          family: string;
          consumed: boolean;
          revoked_at: unknown;
          valid: boolean;
        }>(
          "SELECT s.*, (s.expires_at>now() AND u.status='active') AS valid FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.kind='refresh' FOR UPDATE OF s",
          [digest(token)],
        )
      ).rows[0];
      if (!row || !row.valid || row.revoked_at || row.consumed) {
        if (row)
          await sql.query('UPDATE auth_sessions SET revoked_at=now() WHERE family=$1', [
            row.family,
          ]);
        return null;
      }
      await sql.query('UPDATE auth_sessions SET consumed=true,revoked_at=now() WHERE id=$1', [
        row.id,
      ]);
      const csrf = randomSecret();
      const access = await this.ticket(
        sql,
        row.user_id,
        web ? 'web' : 'access',
        15 * 60_000,
        row.scopes,
        row.family,
        web ? csrf : undefined,
      );
      const refresh = await this.ticket(
        sql,
        row.user_id,
        'refresh',
        30 * 86400_000,
        row.scopes,
        row.family,
      );
      return {
        accessToken: access.token,
        refreshToken: refresh.token,
        expiresAt: access.expiresAt,
        csrfToken: csrf,
      };
    });
    assert(result, 'UNAUTHENTICATED', '刷新凭据已失效，请重新登录。');
    return result;
  }
  async logout(identity: Identity) {
    if (identity.kind !== 'api-key')
      await this.database.query(
        'UPDATE auth_sessions SET revoked_at=now() WHERE family=(SELECT family FROM auth_sessions WHERE id=$1)',
        [identity.sessionId],
      );
  }
  async createApiKey(identity: Identity, name: string, requested: Scope[], days: number) {
    this.require(identity, 'keys:write');
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
  listProviders(...args: Parameters<ProviderService['listProviders']>) {
    return this.providers.listProviders(...args);
  }
  saveProvider(...args: Parameters<ProviderService['saveProvider']>) {
    return this.providers.saveProvider(...args);
  }
  providerDiscoveryCredentials(
    ...args: Parameters<ProviderService['providerDiscoveryCredentials']>
  ) {
    return this.providers.providerDiscoveryCredentials(...args);
  }
  beginUse(...args: Parameters<ProviderService['beginUse']>) {
    return this.providers.beginUse(...args);
  }
}
