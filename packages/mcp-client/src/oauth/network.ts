import { assert } from '@praxis/contracts';
import { fixedEndpointHttp } from '@praxis/transport/http';

export function endpointUrl(raw: string, allowLocalHttp: boolean) {
  const url = new URL(raw);
  assert(
    raw.length <= 2048 &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === 'https:' ||
        (allowLocalHttp &&
          url.protocol === 'http:' &&
          ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))),
    'MCP_OAUTH_ENDPOINT',
    'OAuth 地址须为无认证信息、查询参数和片段的 HTTPS URL；本机 HTTP 须明确允许。',
  );
  return url;
}

/** Discovery never expands its own destination policy. Each SDK request must be explicitly admitted. */
export class OAuthNetwork {
  private endpoints = new Map<string, { method: 'GET' | 'POST'; privateDestination: boolean }>();
  private requests = 0;
  constructor(private signal: AbortSignal) {}
  allow(url: string | URL, method: 'GET' | 'POST', privateDestination: boolean) {
    const parsed = endpointUrl(String(url), privateDestination);
    this.endpoints.set(parsed.href, { method, privateDestination });
  }
  readonly fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const policy = this.endpoints.get(url.href);
    assert(
      policy && (init?.method ?? 'GET') === policy.method,
      'MCP_OAUTH_ENDPOINT',
      'OAuth 请求不属于本次已验证的端点。',
    );
    assert(++this.requests <= 12, 'MCP_OAUTH_LIMIT', 'OAuth 请求次数超限。');
    const http = fixedEndpointHttp(
      {
        endpoint: url.href,
        allowPrivateDestination: policy.privateDestination,
        errorPrefix: 'MCP_OAUTH',
        label: 'OAuth',
        requestTimeoutMs: 15000,
        idleTimeoutMs: 10000,
        maxResponseBytes: 262144,
        maxRequestBytes: 65536,
        maxRequests: 1,
      },
      this.signal,
    );
    try {
      const response = await http.fetch(url, {
        ...init,
        ...(init?.body instanceof URLSearchParams ? { body: init.body.toString() } : {}),
      });
      const body = await response.arrayBuffer();
      return new Response([204, 205, 304].includes(response.status) ? null : body, {
        status: response.status,
        headers: response.headers,
      });
    } finally {
      http.close();
    }
  };
}
