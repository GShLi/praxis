import { assert, PraxisError } from '@praxis/contracts';
import { fixedEndpointHttp } from '@praxis/transport/http';
import type { AvailableModel } from './provider.ts';
import { modelIdSchema, providerEndpoint, providerKeySchema } from './provider.ts';

/** A read-only catalog request. No configuration is saved and no completion is generated. */
export async function discoverModels(
  input: { baseUrl: string; apiKey: string },
  signal: AbortSignal,
  fetcher?: typeof fetch,
): Promise<AvailableModel[]> {
  const endpoint = providerEndpoint(input.baseUrl, 'models');
  const key = providerKeySchema.parse(input.apiKey);
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const http = fetcher
    ? undefined
    : fixedEndpointHttp(
        {
          endpoint: endpoint.href,
          errorPrefix: 'MODEL',
          label: '模型',
          requestTimeoutMs: 10_000,
          idleTimeoutMs: 10_000,
          maxRequests: 1,
          maxResponseBytes: 1024 * 1024,
        },
        bounded,
      );
  try {
    bounded.throwIfAborted();
    const response = await (fetcher ?? http!.fetch)(endpoint, {
      method: 'GET',
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: bounded,
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      if ([401, 403].includes(response.status))
        throw new PraxisError(
          'MODEL_CATALOG_AUTH_FAILED',
          `获取模型列表失败（HTTP ${response.status}），请检查 API Key 和访问权限。`,
        );
      if ([404, 405].includes(response.status))
        throw new PraxisError(
          'MODEL_CATALOG_UNSUPPORTED',
          '此地址不支持模型列表，请核对 Base URL 或手动填写模型 ID。',
        );
      throw new PraxisError(
        'MODEL_CATALOG_HTTP_ERROR',
        `获取模型列表失败（HTTP ${response.status}），请稍后重试。`,
      );
    }
    const reader = response.body?.getReader();
    assert(reader, 'MODEL_CATALOG_INVALID', '模型列表响应为空。');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        bounded.throwIfAborted();
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        assert(bytes <= 1024 * 1024, 'MODEL_CATALOG_LIMIT', '模型列表超过 1 MiB。');
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    let value: unknown;
    try {
      value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new PraxisError('MODEL_CATALOG_INVALID', '供应商没有返回有效的 JSON 模型列表。');
    }
    assert(
      value && typeof value === 'object' && 'data' in value && Array.isArray(value.data),
      'MODEL_CATALOG_INVALID',
      '供应商返回的模型列表格式不兼容。',
    );
    assert(value.data.length <= 2000, 'MODEL_CATALOG_LIMIT', '供应商返回的模型数量超过上限。');
    const ids = new Set<string>();
    for (const item of value.data) {
      const id = modelIdSchema.safeParse(item && typeof item === 'object' ? item.id : undefined);
      assert(id.success, 'MODEL_CATALOG_INVALID', '模型列表中包含无效的模型 ID。');
      assert(
        id.data !== key && (key.length < 8 || !id.data.includes(key)),
        'MODEL_CATALOG_INVALID',
        '供应商返回的模型列表无法安全显示。',
      );
      ids.add(id.data);
    }
    return [...ids].map((id) => ({ id }));
  } catch (error) {
    if (bounded.aborted)
      throw new PraxisError(
        signal.aborted ? 'MODEL_CATALOG_CANCELLED' : 'MODEL_CATALOG_TIMEOUT',
        signal.aborted ? '模型列表查询已取消。' : '获取模型列表超时，请检查地址和网络。',
      );
    if (error instanceof PraxisError) throw error;
    throw new PraxisError(
      'MODEL_CATALOG_CONNECTION_FAILED',
      '无法获取模型列表，请检查网络和 Base URL。',
    );
  } finally {
    http?.close();
  }
}
