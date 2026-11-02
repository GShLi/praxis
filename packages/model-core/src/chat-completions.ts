import { fixedEndpointHttp } from '@praxis/transport/http';
import { readCompletion } from './completion-stream.ts';
import { providerEndpoint } from './provider.ts';
import { requestCompletion } from './request.ts';
import { serializeRequest } from './serialize-request.ts';
import type { Completion, ModelClient, ModelRequest } from './types.ts';

/** OpenAI-compatible chat completions, including DeepSeek reasoning/tool messages. */
export class DeepSeekClient implements ModelClient {
  constructor(private fetcher?: typeof fetch) {}
  async complete(request: ModelRequest): Promise<Completion> {
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
    const { config, signal } = request;
    const body = serializeRequest(request);
    const response = await requestCompletion(fetcher, endpoint, request, body);
    return readCompletion(response, request);
  }
}
