import { assert, PraxisError } from '@praxis/contracts';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export interface AuthorizationReply {
  code: string;
  iss?: string;
}
export class OAuthCallback {
  private consumed = false;
  private resolve!: (reply: AuthorizationReply) => void;
  private reject!: (error: Error) => void;
  readonly reply = new Promise<AuthorizationReply>((resolve, reject) => {
    this.resolve = resolve;
    this.reject = reject;
  });
  private server = createServer(
    { maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 },
    (req, res) => this.receive(req, res),
  );
  private closing: Promise<void> | undefined;
  private constructor(
    private uri: URL,
    private state: string,
    private signal: AbortSignal,
  ) {
    this.server.maxConnections = 8;
    this.server.keepAliveTimeout = 1;
    // The flow starts awaiting reply only after listen and authorization URL construction finish.
    this.reply.catch(() => {});
  }
  static async open(raw: string, state: string, signal: AbortSignal) {
    const uri = new URL(raw);
    assert(
      uri.protocol === 'http:' &&
        ['127.0.0.1', '[::1]'].includes(uri.hostname) &&
        Number(uri.port) >= 1024 &&
        Number(uri.port) <= 65535 &&
        !uri.username &&
        !uri.password &&
        !uri.search &&
        !uri.hash,
      'MCP_OAUTH_CALLBACK',
      '回调必须是预注册的固定本机 IP、端口（1024–65535）和路径。',
    );
    signal.throwIfAborted();
    const callback = new OAuthCallback(uri, state, signal);
    try {
      await callback.listen();
      signal.addEventListener('abort', callback.abort, { once: true });
      if (signal.aborted) callback.abort();
      signal.throwIfAborted();
      return callback;
    } catch {
      await callback.close();
      throw new PraxisError('MCP_OAUTH_CALLBACK', '无法监听已注册的回调端口，或授权已取消。');
    }
  }
  private listen() {
    return new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(Number(this.uri.port), this.uri.hostname.replace(/^\[|\]$/g, ''), () => {
        this.server.off('error', reject);
        this.server.on('error', this.abort);
        resolve();
      });
    });
  }
  private receive(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', "default-src 'none'");
    let url: URL;
    try {
      url = new URL(req.url ?? '/', this.uri.origin);
    } catch {
      res.writeHead(400);
      res.end('无效的授权回调。');
      return;
    }
    const state = url.searchParams.get('state') ?? '';
    if (
      this.consumed ||
      req.method !== 'GET' ||
      url.origin !== this.uri.origin ||
      req.headers.host !== this.uri.host ||
      url.pathname !== this.uri.pathname ||
      (req.url?.length ?? 0) > 8192 ||
      url.searchParams.getAll('state').length !== 1 ||
      Buffer.byteLength(state) !== Buffer.byteLength(this.state) ||
      !timingSafeEqual(Buffer.from(state), Buffer.from(this.state))
    ) {
      res.writeHead(400);
      res.end('无效的授权回调。');
      return;
    }
    const code = url.searchParams.get('code'),
      iss = url.searchParams.get('iss');
    const denied = url.searchParams.has('error');
    const valid = denied
      ? !code
      : Boolean(code && code.length <= 4096 && url.searchParams.getAll('code').length === 1);
    this.consumed = true;
    res.end('授权回调已接收，请返回知行 Praxis。');
    if (!valid || denied || url.searchParams.getAll('iss').length > 1)
      this.reject(new PraxisError('MCP_OAUTH_DENIED', '授权已拒绝或回调参数无效。'));
    else this.resolve({ code: code!, ...(iss ? { iss } : {}) });
  }
  private abort = () => {
    this.reject(new PraxisError('MCP_OAUTH_CANCELLED', '授权已取消或超时。'));
  };
  close() {
    if (this.closing) return this.closing;
    this.signal.removeEventListener('abort', this.abort);
    this.abort();
    this.closing = new Promise<void>((resolve) => {
      this.server.close(() => resolve());
      this.server.closeAllConnections();
    });
    return this.closing;
  }
}
