import type { ModelConfig } from '@praxis/contracts';
import { assert } from '@praxis/contracts';
import type { ModelDiscoveryInput } from '@praxis/model-core/provider';
import {
  modelDiscoverySchema,
  normalizeProviderBaseUrl,
  providerKeySchema,
} from '@praxis/model-core/provider';
import type { ServerDatabase } from '@praxis/storage-server';
import { randomUUID } from 'node:crypto';
import { recordAudit } from './audit.ts';
import { requireScope } from './authorization.ts';
import type { Identity } from './identity.ts';
import type { ProviderInput, ProviderRow } from './provider-schema.ts';
import { providerInputSchema } from './provider-schema.ts';
import { SecretCipher } from './secrets.ts';
export class ProviderService {
  constructor(
    private database: ServerDatabase,
    private cipher: SecretCipher,
  ) {}
  async listProviders(identity: Identity) {
    requireScope(identity, 'providers:read');
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
  async deleteProvider(identity: Identity, id: string, expectedRevision: number) {
    requireScope(identity, 'providers:write');
    const result = await this.database.query(
      'DELETE FROM provider_configs WHERE id=$1 AND user_id=$2 AND revision=$3',
      [id, identity.userId, expectedRevision],
    );
    assert(result.rowCount, 'CONFIG_CONFLICT', '配置不存在或已变化。');
  }
  async saveProvider(
    identity: Identity,
    input: ProviderInput,
    key: string | undefined,
    id?: string,
    expectedRevision?: number,
  ) {
    requireScope(identity, 'providers:write');
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
      await recordAudit(sql, identity.userId, 'provider/save', resource);
      return { id: resource, revision, ...input, keyConfigured: true };
    });
  }
  async providerDiscoveryCredentials(
    identity: Identity,
    raw: ModelDiscoveryInput,
    direct = false,
  ): Promise<{ baseUrl: string; apiKey: string }> {
    requireScope(identity, 'providers:write');
    if (direct) {
      assert(identity.kind !== 'web', 'FORBIDDEN', 'Web 页面不能读取厂商 Key。');
      requireScope(identity, 'client:direct');
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
    requireScope(identity, direct ? 'client:direct' : 'chats:write');
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
