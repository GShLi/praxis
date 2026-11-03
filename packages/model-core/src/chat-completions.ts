import { fixedEndpointHttp } from '@praxis/transport/http';
import { assert } from '@praxis/contracts';
import { readCompletion } from './completion-stream.ts';
import { providerEndpoint } from './provider.ts';
import { requestCompletion } from './request.ts';
import { serializeRequest } from './serialize-request.ts';
import type { Completion, ModelClient, ModelRequest } from './types.ts';

/** OpenAI-compatible chat completions, including DeepSeek reasoning/tool messages. */
export class DeepSeekClient implements ModelClient {
  constructor(private fetcher?: typeof fetch) {}
  async complete(request: ModelRequest): Promise<Completion> {
    assert(
      !request.config.adapter || request.config.adapter === 'openai-compatible',
      'PROVIDER_ADAPTER_UNAVAILABLE',
      '当前运行位置未加载所选插件模型适配器。',
    );
    const endpoint = providerEndpoint(request.config.baseUrl, 'chat/completions');
    const http = this.fetcher
      ? undefined
      : fixedEndpointHttp(
          {
            endpoint: endpoint.href,
            errorPrefix: 'MODEL',
            label: '模型',
            requestTimeoutMs: 300_000,
            idleTimeoutMs: 60_000,
            maxRequests: 3,
          },
          request.signal,
        );
    try {
      return await this.completeAt(request, endpoint, this.fetcher ?? http!.fetch);
    } finally {
      http?.close();
    }
  }
  private async completeAt(
    request: ModelRequest,
    endpoint: URL,
    fetcher: typeof fetch,
  ): Promise<Completion> {
    const body = serializeRequest(request);
    const response = await requestCompletion(fetcher, endpoint, request, body);
    return readCompletion(response, request);
  }
}
