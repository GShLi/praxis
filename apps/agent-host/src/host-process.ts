import { assert, initializeSchema, PraxisError, PROTOCOL } from '@praxis/contracts';
import { JsonLines, serveRpc } from '@praxis/transport';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { HostIdentity } from './identity.ts';
import { mcpRoutes } from './mcp-rpc.ts';
import { pluginsRoutes } from './plugins-rpc.ts';
import { providersRoutes } from './providers-rpc.ts';
import type { RpcRoutes } from './rpc-schema.ts';
import { noArgs } from './rpc-schema.ts';
import { sessionsRoutes } from './sessions-rpc.ts';
import { commandsRoutes } from './commands-rpc.ts';

/** Owns process listeners, timers and the authenticated resource scope. */
export class HostProcess {
  private readonly instanceId = randomUUID();
  private initialized = false;
  private clientKind: 'cli' | 'desktop' = 'cli';
  private lastHeartbeat = performance.now();
  private closing = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  private readonly identity: HostIdentity;
  private readonly routes: RpcRoutes;
  constructor(private channel: JsonLines) {
    this.identity = new HostIdentity(
      () => this.clientKind,
      () => this.closing,
      this.stop,
      this.notify,
    );
    this.routes = Object.assign(
      {},
      ...[providersRoutes, sessionsRoutes, mcpRoutes, pluginsRoutes, commandsRoutes].map(
        (factory) => factory(this.identity, () => this.clientKind),
      ),
    );
  }
  private notify = (method: string, params: unknown) => {
    try {
      this.channel.send({ jsonrpc: '2.0', method, params });
    } catch {
      this.stop();
    } // A disconnected transport ends the owning Host.
  };
  private stop = () => {
    void this.shutdown().catch(() => process.exit(1));
  };
  start() {
    this.timers.push(
      setInterval(() => {
        if (performance.now() - this.lastHeartbeat > 15_000 || process.ppid === 1) this.stop();
      }, 1000),
    );
    this.timers.push(
      setInterval(() => {
        const store = this.identity.store;
        if (!store || this.closing) return;
        try {
          for (const [id, cursor] of this.identity.subscriptions)
            for (const event of store.events(id, cursor, 100)) {
              this.notify('session/event', event);
              this.identity.subscriptions.set(id, event.seq);
            }
        } catch {
          this.stop();
        } // Failed event persistence must not leave a silent running Host.
      }, 100),
    );
    this.channel.on('close', this.stop);
    process.once('SIGTERM', this.stop);
    process.once('SIGINT', this.stop);
    serveRpc(this.channel, (method, params) => this.dispatch(method, params));
  }
  private async dispatch(method: string, params: unknown) {
    if (method === 'host/initialize') {
      assert(!this.initialized, 'ALREADY_INITIALIZED', 'Host 已初始化。');
      const input = initializeSchema.parse(params);
      assert(
        input.protocolMajor === PROTOCOL.major,
        'PROTOCOL_MISMATCH',
        'Host 协议主版本不兼容。',
      );
      this.initialized = true;
      this.clientKind = input.clientKind;
      this.lastHeartbeat = performance.now();
      return {
        ...PROTOCOL,
        hostInstanceId: this.instanceId,
        nonce: input.nonce,
        capabilities: ['sessions', 'files', 'context', 'questions', 'chat'],
        storageVersion: 2,
      };
    }
    assert(this.initialized && !this.closing, 'NOT_INITIALIZED', 'Host 尚未初始化或正在退出。');
    if (method === 'host/ping') {
      noArgs.parse(params);
      this.lastHeartbeat = performance.now();
      return { ok: true };
    }
    if (method === 'host/shutdown') {
      noArgs.parse(params);
      setImmediate(this.stop);
      return { accepted: true };
    }
    if (method === 'host/diagnostics') {
      noArgs.parse(params);
      return {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        protocol: PROTOCOL,
        agentAvailable: Boolean(this.identity.auth),
        commandExecution: 'unavailable: native isolation not yet verified',
        authenticated: Boolean(this.identity.auth),
      };
    }
    if (method === 'auth/bind') return this.identity.bind(params);
    if (method === 'auth/clear') {
      noArgs.parse(params);
      assert(!this.identity.binding, 'AUTH_BUSY', '身份切换正在进行。');
      await this.identity.clear();
      return { ok: true };
    }
    this.identity.require();
    const handler = Object.hasOwn(this.routes, method) ? this.routes[method] : undefined;
    if (!handler) throw new PraxisError('METHOD_NOT_FOUND', '此 Host 不支持该方法。');
    return handler(params);
  }
  private async shutdown() {
    if (this.closing) return;
    this.closing = true;
    for (const timer of this.timers) clearInterval(timer);
    this.channel.off('close', this.stop);
    process.off('SIGTERM', this.stop);
    process.off('SIGINT', this.stop);
    const deadline = setTimeout(() => process.exit(1), 4500);
    await this.identity.clear();
    this.channel.close();
    process.stdin.pause();
    clearTimeout(deadline);
    process.stdout.end(() => process.exit(0));
  }
}
