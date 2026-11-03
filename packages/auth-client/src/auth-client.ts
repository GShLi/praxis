import type { ModelConfig } from '@praxis/contracts';
import { providerModelChoices, type ProviderModel } from '@praxis/model-core/provider-models';
import { assert, PraxisError } from '@praxis/contracts';
import { discoverModels } from '@praxis/model-core/catalog';
import type { ModelDiscoveryInput } from '@praxis/model-core/provider';
import {
  modelDiscoverySchema,
  providerBaseUrlSchema,
  providerKeySchema,
} from '@praxis/model-core/provider';
import { z } from 'zod';
import { modelSchema } from './model-schema.ts';

export class AuthClient {
  private accessToken = '';
  private expiresAt = 0;
  private apiKey = '';
  readonly origin: string;
  userId = '';
  constructor(
    serverUrl: string,
    private fetcher: typeof fetch = fetch,
  ) {
    const url = new URL(serverUrl);
    assert(
      !url.username && !url.password && !url.search && !url.hash && url.pathname === '/',
      'INVALID_SERVER_URL',
      '服务地址须为来源 URL。',
    );
    assert(
      url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)),
      'TLS_REQUIRED',
      '远程 Praxis 服务必须使用 HTTPS。',
    );
    this.origin = url.origin;
  }
  async bind(apiKey: string, signal: AbortSignal) {
    assert(
      apiKey.startsWith('pxk_.'),
      'INVALID_PRAXIS_KEY',
      '请提供 Praxis API Key，不是模型厂商 Key。',
    );
    this.apiKey = apiKey;
    await this.exchange(signal);
    return { userId: this.userId };
  }
  private async exchange(signal: AbortSignal) {
    const result = await this.request<{ accessToken: string; expiresAt: string; userId: string }>(
      '/v1/auth/token',
      'POST',
      {},
      signal,
      this.apiKey,
    );
    this.accessToken = result.accessToken;
    this.expiresAt = Date.parse(result.expiresAt);
    this.userId = result.userId;
  }
  private async request<T>(
    path: string,
    method: string,
    body: unknown,
    signal: AbortSignal,
    token = this.accessToken,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(this.origin + path, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        redirect: 'error',
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new PraxisError('SERVER_UNAVAILABLE', '无法连接 Praxis 服务，请检查地址和网络。');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new PraxisError(
        response.status === 401 ? 'UNAUTHENTICATED' : 'SERVER_REQUEST_FAILED',
        `Praxis 请求失败（HTTP ${response.status}）。`,
      );
    }
    const reader = response.body?.getReader();
    assert(reader, 'SERVER_RESPONSE_INVALID', '服务响应为空。');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        assert(size <= 1024 * 1024, 'SERVER_RESPONSE_LIMIT', '服务响应超限。');
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel().catch(() => {
        /* Preserve the HTTP/read failure; always release the reader lock. */
      });
      reader.releaseLock();
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  }
  async beginUse(providerId: string | undefined, signal: AbortSignal): Promise<ModelConfig> {
    assert(this.apiKey, 'UNAUTHENTICATED', '请先登录 Praxis。');
    if (Date.now() + 10_000 >= this.expiresAt) await this.exchange(signal);
    const selected =
      providerId ?? providerModelChoices(await this.providers(signal)).find((p) => p.enabled)?.id;
    assert(selected, 'PROVIDER_NOT_FOUND', '请先配置模型提供商。');
    return modelSchema.parse(
      await this.request('/v1/client/provider-uses', 'POST', { providerId: selected }, signal),
    );
  }
  async providers(signal: AbortSignal): Promise<
    Array<{
      id: string;
      name: string;
      model: string;
      enabled: boolean;
      revision: number;
      contextWindow: number;
      maxOutputTokens: number;
      models?: ProviderModel[];
      defaultModelId?: string;
    }>
  > {
    if (Date.now() + 10_000 >= this.expiresAt) await this.exchange(signal);
    return this.request('/v1/providers', 'GET', undefined, signal);
  }
  async profile(signal: AbortSignal) {
    if (Date.now() + 10_000 >= this.expiresAt) await this.exchange(signal);
    return this.request<{ id: string; username: string; scopes: string[] }>(
      '/v1/me',
      'GET',
      undefined,
      signal,
    );
  }
  async deleteProvider(id: string, expectedRevision: number, signal: AbortSignal) {
    if (Date.now() + 10_000 >= this.expiresAt) await this.exchange(signal);
    return this.request(
      `/v1/providers/${encodeURIComponent(id)}`,
      'DELETE',
      { expectedRevision },
      signal,
    );
  }
  async clear() {
    if (this.accessToken)
      await this.request('/v1/auth/logout', 'POST', {}, AbortSignal.timeout(1000)).catch(() => {
        /* Logout still clears local tokens when the server is unreachable. */
      });
    this.apiKey = '';
    this.accessToken = '';
    this.userId = '';
    this.expiresAt = 0;
  }
  async discoverModels(raw: ModelDiscoveryInput, signal: AbortSignal, fetcher?: typeof fetch) {
    assert(this.apiKey, 'UNAUTHENTICATED', '请先登录 Praxis。');
    const input = modelDiscoverySchema.parse(raw);
    assert(
      !input.adapter || input.adapter === 'openai-compatible',
      'MODEL_CATALOG_UNSUPPORTED',
      '插件模型请按插件说明手动填写模型 ID。',
    );
    let credentials = { baseUrl: input.baseUrl, apiKey: input.apiKey ?? '' };
    if (!input.apiKey) {
      if (Date.now() + 10_000 >= this.expiresAt) await this.exchange(signal);
      credentials = z
        .strictObject({ baseUrl: providerBaseUrlSchema, apiKey: providerKeySchema })
        .parse(await this.request('/v1/client/provider-discovery', 'POST', input, signal));
      assert(
        credentials.baseUrl === input.baseUrl,
        'CONFIG_CONFLICT',
        '配置地址已变化，请重新加载。',
      );
    }
    signal.throwIfAborted();
    return discoverModels(credentials, signal, fetcher);
  }
  async saveProvider(
    input: { config: unknown; apiKey?: string; id?: string; expectedRevision?: number },
    signal: AbortSignal,
  ) {
    if (Date.now() + 10_000 >= this.expiresAt) await this.exchange(signal);
    return this.request(
      `/v1/providers${input.id ? '/' + encodeURIComponent(input.id) : ''}`,
      input.id ? 'PUT' : 'POST',
      {
        config: input.config,
        ...(input.apiKey ? { apiKey: input.apiKey } : {}),
        ...(input.id ? { expectedRevision: input.expectedRevision } : {}),
      },
      signal,
    );
  }
}
