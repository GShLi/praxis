import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { z } from 'zod';
import {
  modelIdSchema,
  modelDiscoverySchema,
  normalizeProviderBaseUrl,
  providerBaseUrlSchema,
  providerKeySchema,
} from '../../model-core/src/provider.ts';
import type { ModelDiscoveryInput } from '../../model-core/src/provider.ts';
import { assert, PraxisError } from '../../contracts/src/index.ts';
import type { ModelConfig } from '../../contracts/src/index.ts';
import type { ServerDatabase, SqlConnection } from '../../storage-server/src/index.ts';

export const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const randomSecret = () => randomBytes(32).toString('base64url');
const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const argonOptions = { t: 2, m: 19456, p: 1, dkLen: 32 } as const;
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
interface Encrypted {
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
export const scopes = [
  'profile:read',
  'providers:read',
  'providers:write',
  'client:direct',
  'chats:read',
  'chats:write',
  'keys:write',
] as const;
export type Scope = (typeof scopes)[number];
export interface Identity {
  userId: string;
  sessionId: string;
  username: string;
  admin: boolean;
  scopes: Scope[];
  kind: 'web' | 'access' | 'api-key';
  csrfHash?: string;
}
export const providerInputSchema = z
  .strictObject({
    name: z.string().min(1).max(100),
    model: modelIdSchema,
    baseUrl: providerBaseUrlSchema.default('https://api.deepseek.com'),
    contextWindow: z.number().int().min(8192).max(2_000_000),
    maxOutputTokens: z.number().int().min(256).max(393216),
    enabled: z.boolean().default(true),
  })
  .refine((v) => v.maxOutputTokens < v.contextWindow / 2, 'Output budget too large');
export type ProviderInput = z.infer<typeof providerInputSchema>;
type ProviderRow = {
  id: string;
  user_id: string;
  revision: number;
  config: ProviderInput;
  encrypted_key: Encrypted;
  enabled: boolean;
};
export class AuthService {
  constructor(
    readonly database: ServerDatabase,
    readonly cipher: SecretCipher,
  ) {}
  private audit(
    sql: SqlConnection,
    actor: string,
    operation: string,
    resource: string,
    outcome = 'success',
  ) {
    return sql.query(
      'INSERT INTO audit_events(actor,operation,resource_id,outcome) VALUES($1,$2,$3,$4)',
      [actor, operation, resource, outcome],
    );
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
      await this.audit(sql, 'admin-cli', 'user/create', id);
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
      await this.audit(sql, user.id, 'auth/login', family);
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
      await this.audit(sql, identity.userId, 'api-key/create', id);
    });
    return { id, key: `pxk_.${id}.${secret}`, expiresAt: expiresAt.toISOString() };
  }
  async listProviders(identity: Identity) {
    this.require(identity, 'providers:read');
    const result = await this.database.query<ProviderRow>(
      'SELECT id,revision,config,enabled FROM provider_configs WHERE user_id=$1 ORDER BY id',
      [identity.userId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      revision: row.revision,
      ...row.config,
      enabled: row.enabled,
      keyConfigured: true,
    }));
  }
  async saveProvider(
    identity: Identity,
    input: ProviderInput,
    key: string | undefined,
    id?: string,
    expectedRevision?: number,
  ) {
    this.require(identity, 'providers:write');
    input = providerInputSchema.parse(input);
    if (key !== undefined) key = providerKeySchema.parse(key);
    return this.database.transaction(async (sql) => {
      let revision = 1;
      const resource = id ?? randomUUID();
      let secret = key;
      if (id) {
        const previous = (
          await sql.query<ProviderRow>(
            'SELECT * FROM provider_configs WHERE id=$1 AND user_id=$2 FOR UPDATE',
            [id, identity.userId],
          )
        ).rows[0];
        assert(previous, 'PROVIDER_NOT_FOUND', '模型配置不存在。');
        assert(
          previous.revision === expectedRevision,
          'CONFIG_CONFLICT',
          '配置已被修改，请重新加载。',
        );
        assert(
          key || input.baseUrl === normalizeProviderBaseUrl(previous.config.baseUrl),
          'KEY_REQUIRED',
          'Base URL 已改变，请重新填写此地址对应的 API Key。',
        );
        revision = previous.revision + 1;
        secret ??= this.cipher.decrypt(
          previous.encrypted_key,
          identity.userId,
          id,
          previous.revision,
        );
      }
      assert(secret, 'KEY_REQUIRED', '请提供模型厂商 Key。');
      const encrypted = this.cipher.encrypt(secret, identity.userId, resource, revision);
      await sql.query(
        'INSERT INTO provider_configs(id,user_id,revision,config,encrypted_key,enabled) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET revision=EXCLUDED.revision,config=EXCLUDED.config,encrypted_key=EXCLUDED.encrypted_key,enabled=EXCLUDED.enabled',
        [
          resource,
          identity.userId,
          revision,
          JSON.stringify(input),
          JSON.stringify(encrypted),
          input.enabled,
        ],
      );
      await this.audit(sql, identity.userId, 'provider/save', resource);
      return { id: resource, revision, ...input, keyConfigured: true };
    });
  }
  async providerDiscoveryCredentials(
    identity: Identity,
    raw: ModelDiscoveryInput,
    direct = false,
  ): Promise<{ baseUrl: string; apiKey: string }> {
    this.require(identity, 'providers:write');
    if (direct) {
      assert(identity.kind !== 'web', 'FORBIDDEN', 'Web 页面不能读取厂商 Key。');
      this.require(identity, 'client:direct');
    }
    const input = modelDiscoverySchema.parse(raw);
    let key = input.apiKey;
    if (input.id) {
      const row = (
        await this.database.query<ProviderRow>(
          'SELECT * FROM provider_configs WHERE id=$1 AND user_id=$2',
          [input.id, identity.userId],
        )
      ).rows[0];
      assert(row, 'PROVIDER_NOT_FOUND', '模型配置不存在。');
      assert(
        row.revision === input.expectedRevision,
        'CONFIG_CONFLICT',
        '配置已被修改，请重新加载。',
      );
      assert(
        key || input.baseUrl === normalizeProviderBaseUrl(row.config.baseUrl),
        'KEY_REQUIRED',
        'Base URL 已改变，请重新填写此地址对应的 API Key。',
      );
      key ??= this.cipher.decrypt(row.encrypted_key, identity.userId, input.id, row.revision);
    }
    assert(key, 'KEY_REQUIRED', '请填写 API Key 后获取模型列表。');
    return { baseUrl: input.baseUrl, apiKey: key };
  }
  async beginUse(identity: Identity, id: string, direct: boolean): Promise<ModelConfig> {
    this.require(identity, direct ? 'client:direct' : 'chats:write');
    const row = (
      await this.database.query<ProviderRow>(
        'SELECT * FROM provider_configs WHERE id=$1 AND user_id=$2 AND enabled=true',
        [id, identity.userId],
      )
    ).rows[0];
    assert(row, 'PROVIDER_NOT_FOUND', '模型配置不存在或已停用。');
    return {
      id,
      revision: row.revision,
      baseUrl: row.config.baseUrl,
      model: row.config.model,
      contextWindow: row.config.contextWindow,
      maxOutputTokens: row.config.maxOutputTokens,
      apiKey: this.cipher.decrypt(row.encrypted_key, identity.userId, id, row.revision),
    };
  }
}
