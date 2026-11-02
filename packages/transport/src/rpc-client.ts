import { PraxisError } from '@praxis/contracts';
import { EventEmitter } from 'node:events';
import { JsonLines } from './json-lines.ts';

export class RpcClient extends EventEmitter {
  private ordinal = 0;
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  constructor(readonly channel: JsonLines) {
    super();
    channel.on('frame', (frame: Record<string, unknown>) => {
      if (frame.method && !frame.id) {
        this.emit('notification', frame.method, frame.params);
        return;
      }
      const key = String(frame.id);
      const request = this.pending.get(key);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(key);
      if (frame.error) {
        const e = frame.error as { code: string; safeMessage: string };
        request.reject(new PraxisError(e.code, e.safeMessage));
      } else request.resolve(frame.result);
    });
    channel.on('close', () => {
      for (const item of this.pending.values()) {
        clearTimeout(item.timer);
        item.reject(new PraxisError('CONNECTION_CLOSED', 'Host 已退出。'));
      }
      this.pending.clear();
      this.emit('close');
    });
  }
  request<T = unknown>(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<T> {
    const id = String(++this.ordinal);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new PraxisError('RPC_TIMEOUT', 'Host 响应超时。'));
      }, timeoutMs);
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject, timer });
      try {
        this.channel.send({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
}
