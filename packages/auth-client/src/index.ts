import { z } from 'zod';
import { assert, PraxisError } from '../../contracts/src/index.ts';
import type { ModelConfig } from '../../contracts/src/index.ts';

const modelSchema = z.strictObject({
  id: z.string(),
  revision: z.number().int(),
  baseUrl: z.literal('https://api.deepseek.com'),
  model: z.string(),
  apiKey: z.string(),
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
});
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
    const text = await response.text();
    assert(Buffer.byteLength(text) <= 1024 * 1024, 'SERVER_RESPONSE_LIMIT', '服务响应超限。');
    return JSON.parse(text) as T;
  }
  async beginUse(providerId: string | undefined, signal: AbortSignal): Promise<ModelConfig> {
    assert(this.apiKey, 'UNAUTHENTICATED', '请先登录 Praxis。');
    if (Date.now() + 10_000 >= this.expiresAt) await this.exchange(signal);
    const selected = providerId ?? (await this.providers(signal)).find((p) => p.enabled)?.id;
    assert(selected, 'PROVIDER_NOT_FOUND', '请先配置模型提供商。');
    return modelSchema.parse(
      await this.request('/v1/client/provider-uses', 'POST', { providerId: selected }, signal),
    );
  }
  async providers(
    signal: AbortSignal,
  ): Promise<
    Array<{ id: string; name: string; model: string; enabled: boolean; revision: number }>
  > {
    if (Date.now() + 10_000 >= this.expiresAt) await this.exchange(signal);
    return this.request('/v1/providers', 'GET', undefined, signal);
  }
  async clear() {
    this.apiKey = '';
    this.accessToken = '';
    this.userId = '';
    this.expiresAt = 0;
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
