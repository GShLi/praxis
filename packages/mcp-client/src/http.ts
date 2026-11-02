import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import { assert, PraxisError } from '../../contracts/src/index.ts';
import { validateConfig } from '../../mcp-core/src/index.ts';
import type { McpConfig } from '../../mcp-core/src/index.ts';

type Address = { address: string; family: number };
export interface HttpDependencies {
  resolve(hostname: string): Promise<Address[]>;
  request(
    url: URL,
    options: RequestOptions,
    response: (value: IncomingMessage) => void,
  ): ClientRequest;
}
const defaults: HttpDependencies = {
  resolve: (hostname) => lookup(hostname, { all: true, verbatim: true }),
  request: (url, options, response) =>
    (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, options, response),
};
const denied = new BlockList();
for (const [address, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const)
  denied.addSubnet(address, bits, 'ipv4');
for (const [address, bits] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const)
  denied.addSubnet(address, bits, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
export function isPublicAddress(address: string) {
  const family = isIP(address);
  return family === 4
    ? !denied.check(address, 'ipv4')
    : family === 6 && globalV6.check(address, 'ipv6') && !denied.check(address, 'ipv6');
}
function interrupted(signal: AbortSignal) {
  return signal.reason instanceof PraxisError
    ? signal.reason
    : new PraxisError(
        signal.reason?.name === 'TimeoutError' ? 'MCP_OPERATION_TIMEOUT' : 'MCP_CANCELLED',
        'MCP 请求已超时或取消。',
      );
}
/** The lookup may not support cancellation; late DNS results must never open a socket. */
async function resolveWithin(resolve: Promise<Address[]>, signal: AbortSignal) {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  try {
    return await Promise.race([
      resolve,
      new Promise<never>((_, reject) => {
        abort = () => reject(interrupted(signal));
        signal.addEventListener('abort', abort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

/** No global fetch, proxy inheritance, cookie jar, redirect or DNS check/connect gap. */
export function controlledHttp(
  config: McpConfig,
  scopeSignal: AbortSignal,
  dependencies: HttpDependencies = defaults,
) {
  const transport = validateConfig(config).transport;
  assert(transport.type === 'streamable-http', 'MCP_TRANSPORT_INVALID', '需要 HTTP 服务器配置。');
  const endpoint = new URL(transport.endpoint),
    scope = new AbortController();
  let requestCount = 0;
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert(url.href === endpoint.href, 'MCP_ENDPOINT_CHANGED', '请求不属于已配置的固定端点。');
    const signal = AbortSignal.any([
      scopeSignal,
      scope.signal,
      AbortSignal.timeout(60_000),
      ...(init?.signal ? [init.signal] : []),
    ]);
    signal.throwIfAborted();
    assert(++requestCount <= 80, 'MCP_REQUEST_LIMIT', '本次操作的网络请求数量超限。');
    const method = init?.method ?? 'GET';
    assert(
      ['POST', 'GET', 'DELETE'].includes(method),
      'MCP_METHOD_UNSUPPORTED',
      'MCP HTTP 方法不支持。',
    );
    assert(
      init?.body == null || typeof init.body === 'string',
      'MCP_BODY_INVALID',
      '只允许有界 JSON 请求体。',
    );
    const body = init?.body ?? undefined;
    assert(
      !body || Buffer.byteLength(body) <= 8 * 1024 * 1024,
      'MCP_FRAME_LIMIT',
      '请求超过 8 MiB。',
    );
    const headers = new Headers(init?.headers);
    for (const name of [
      'cookie',
      'host',
      'proxy-authorization',
      'connection',
      'transfer-encoding',
      'content-length',
    ]) {
      assert(!headers.has(name), 'MCP_HEADER_INVALID', '请求包含受保护的网络 Header。');
    }
    headers.set('accept-encoding', 'identity');
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    let addresses: Address[];
    try {
      addresses = isIP(hostname)
        ? [{ address: hostname, family: isIP(hostname) }]
        : await resolveWithin(dependencies.resolve(hostname), signal);
    } catch (error) {
      if (signal.aborted) throw interrupted(signal);
      throw new PraxisError('MCP_DNS_FAILED', 'MCP 端点 DNS 解析失败。');
    }
    signal.throwIfAborted();
    assert(
      addresses.length > 0 &&
        addresses.length <= 64 &&
        addresses.every((a) => isIP(a.address) === a.family),
      'MCP_DNS_INVALID',
      '端点地址解析结果无效。',
    );
    assert(
      transport.allowPrivateDestination || addresses.every((a) => isPublicAddress(a.address)),
      'MCP_PRIVATE_DESTINATION',
      '此端点解析到私网或保留地址，需要在配置中明确允许此固定地址。',
    );
    const pinned = addresses[0]!;
    return new Promise<Response>((resolve, reject) => {
      let request: ClientRequest | undefined, response: IncomingMessage | undefined;
      let stream: ReadableStreamDefaultController<Uint8Array> | undefined,
        finished = false,
        bytes = 0;
      const cleanup = () => signal.removeEventListener('abort', abort);
      const fail = (error: PraxisError) => {
        if (finished) return;
        finished = true;
        cleanup();
        stream?.error(error);
        reject(error);
        response?.destroy();
        request?.destroy();
      };
      const abort = () => fail(interrupted(signal));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      try {
        request = dependencies.request(
          url,
          {
            method,
            agent: false,
            family: pinned.family,
            headers: Object.fromEntries(headers),
            maxHeaderSize: 32 * 1024,
            // Node still uses the original URL hostname for Host/SNI/certificate validation.
            lookup: (_hostname, options, callback) => {
              if (options.all) callback(null, [pinned]);
              else callback(null, pinned.address, pinned.family);
            },
          },
          (incoming) => {
            response = incoming;
            if (finished) {
              incoming.destroy();
              return;
            }
            const status = incoming.statusCode ?? 0;
            if (status >= 300 && status < 400) {
              fail(
                new PraxisError('MCP_REDIRECT_DENIED', 'MCP 端点返回重定向；请核对服务器地址。'),
              );
              return;
            }
            if (status < 200 || status > 599) {
              fail(new PraxisError('MCP_HTTP_INVALID', '无效的 HTTP 状态。'));
              return;
            }
            const encoding = incoming.headers['content-encoding'];
            if (encoding && encoding !== 'identity') {
              fail(new PraxisError('MCP_ENCODING_UNSUPPORTED', '服务器必须返回未压缩的有界响应。'));
              return;
            }
            const length = incoming.headers['content-length'];
            if (length && (!/^\d+$/.test(length) || Number(length) > 8 * 1024 * 1024)) {
              fail(new PraxisError('MCP_FRAME_LIMIT', '响应超过 8 MiB。'));
              return;
            }
            const responseHeaders = new Headers();
            for (const [name, value] of Object.entries(incoming.headers)) {
              // No credential/cookie propagation and no remote reason phrase in errors.
              if (value !== undefined && name !== 'set-cookie')
                responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
            }
            incoming.on('error', () =>
              fail(new PraxisError('MCP_NETWORK_FAILED', 'MCP 响应连接中断，未自动重试。')),
            );
            incoming.on('aborted', () =>
              fail(new PraxisError('MCP_NETWORK_FAILED', 'MCP 响应未完整接收，未自动重试。')),
            );
            incoming.on('end', () => {
              if (!finished) {
                finished = true;
                cleanup();
                stream?.close();
              }
            });
            if ([204, 205, 304].includes(status)) {
              incoming.resume();
              resolve(new Response(null, { status, headers: responseHeaders }));
              return;
            }
            incoming.pause();
            const readable = new ReadableStream<Uint8Array>({
              start(controller) {
                stream = controller;
                incoming.on('data', (chunk: Buffer) => {
                  if (finished) return;
                  bytes += chunk.byteLength;
                  if (bytes > 8 * 1024 * 1024) {
                    fail(new PraxisError('MCP_FRAME_LIMIT', '响应超过 8 MiB。'));
                    return;
                  }
                  controller.enqueue(new Uint8Array(chunk));
                  if ((controller.desiredSize ?? 0) <= 0) incoming.pause();
                });
              },
              pull() {
                incoming.resume();
              },
              cancel() {
                if (!finished) {
                  finished = true;
                  cleanup();
                  incoming.destroy();
                  request?.destroy();
                }
              },
            });
            resolve(new Response(readable, { status, headers: responseHeaders }));
          },
        );
        request.on('error', () =>
          fail(new PraxisError('MCP_NETWORK_FAILED', 'MCP 网络或 TLS 连接失败，未自动重试。')),
        );
        request.setTimeout(15_000, () =>
          fail(new PraxisError('MCP_OPERATION_TIMEOUT', 'MCP 网络连接空闲超时。')),
        );
        request.end(body);
      } catch {
        fail(new PraxisError('MCP_NETWORK_FAILED', 'MCP HTTP 请求未能建立。'));
      }
    });
  };
  return { fetch, close: () => scope.abort(new PraxisError('MCP_CANCELLED', 'MCP 操作已结束。')) };
}
