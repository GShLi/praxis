import { assert, PraxisError } from '@praxis/contracts';
import { setTimeout as delay } from 'node:timers/promises';
import type { ModelRequest } from './types.ts';
import { isOverflowResponse } from './overflow-error.ts';

export async function requestCompletion(
  fetcher: typeof fetch,
  endpoint: URL,
  request: ModelRequest,
  body: string,
) {
  const { config, signal } = request;
  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    if (attempt) request.beforeRetry?.();
    try {
      response = await fetcher(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
        body,
        signal,
        redirect: 'error',
      });
    } catch (error) {
      if (signal.aborted || error instanceof PraxisError) throw error;
      throw new PraxisError(
        'MODEL_CONNECTION_FAILED',
        '模型连接失败，请检查网络、代理及厂商地址。',
      );
    }
    if (response.ok) break;
    const status = response.status;
    const retryAfter = Math.min(
      10_000,
      Math.max(0, Number(response.headers.get('retry-after') ?? 0) * 1000),
    );
    // Error bodies may contain secrets echoed by gateways; never persist or display them.
    if (status === 400 || status === 422) {
      if (await isOverflowResponse(response, signal))
        throw new PraxisError('MODEL_CONTEXT_OVERFLOW', '模型明确报告输入超过上下文窗口。');
    } else await response.body?.cancel();
    if ([408, 429, 500, 502, 503, 504].includes(status) && attempt < 2) {
      await delay(Math.max(retryAfter, 500 * 2 ** attempt), undefined, { signal });
      continue;
    }
    throw new PraxisError(
      status === 401 || status === 403 ? 'MODEL_AUTH_FAILED' : 'MODEL_HTTP_ERROR',
      `模型请求失败（HTTP ${status}）。`,
      status === 429 || status >= 500,
    );
  }

  assert(response?.ok && response.body, 'MODEL_EMPTY_RESPONSE', '模型未返回响应流。');
  return response;
}
