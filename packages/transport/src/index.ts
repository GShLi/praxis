import { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { z } from 'zod';
import { MAX_FRAME_BYTES, PraxisError, safeError } from '../../contracts/src/index.ts';

const requestSchema = z.strictObject({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().min(1),
  params: z.unknown().optional(),
});
export type Handler = (method: string, params: unknown) => Promise<unknown> | unknown;

/** Bounded byte framing: never buffers an unbounded unterminated JSON line. */
export class JsonLines extends EventEmitter {
  private buffer = Buffer.alloc(0);
  private closed = false;
  constructor(
    private input: Readable,
    private output: Writable,
  ) {
    super();
    input.on('data', (chunk: Buffer | string) => this.consume(Buffer.from(chunk)));
    input.on('end', () => this.close());
    input.on('error', () => this.close());
    output.on('error', () => this.close());
  }
  private consume(chunk: Buffer) {
    if (this.closed) return;
    // Account for each line, allowing multiple valid frames in one chunk.
    let offset = 0;
    while (offset < chunk.length) {
      const end = chunk.indexOf(10, offset);
      const part = chunk.subarray(offset, end === -1 ? chunk.length : end);
      if (this.buffer.length + part.length > MAX_FRAME_BYTES) {
        this.emit('invalid', 'FRAME_TOO_LARGE');
        this.close();
        return;
      }
      this.buffer = Buffer.concat([this.buffer, part]);
      if (end === -1) return;
      try {
        this.emit(
          'frame',
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(this.buffer)),
        );
      } catch {
        this.emit('invalid', 'INVALID_FRAME');
        this.close();
        return;
      }
      this.buffer = Buffer.alloc(0);
      offset = end + 1;
    }
  }
  send(value: unknown) {
    if (this.closed) throw new PraxisError('CONNECTION_CLOSED', 'Host 连接已关闭。');
    const data = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(data) > MAX_FRAME_BYTES || this.output.writableLength > MAX_FRAME_BYTES) {
      this.close();
      throw new PraxisError('BACKPRESSURE', '连接缓冲超限，请重新同步。');
    }
    this.output.write(data);
  }
  close() {
    if (!this.closed) {
      this.closed = true;
      this.buffer = Buffer.alloc(0);
      this.emit('close');
    }
  }
}

export function serveRpc(channel: JsonLines, handler: Handler) {
  channel.on('frame', (raw: unknown) => {
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) {
      channel.send({
        jsonrpc: '2.0',
        id: null,
        error: { code: 'INVALID_REQUEST', safeMessage: '无效 RPC 请求。' },
      });
      return;
    }
    const { method, params, id } = parsed.data;
    void Promise.resolve()
      .then(() => handler(method, params))
      .then(
        (result) => {
          if (id !== undefined) channel.send({ jsonrpc: '2.0', id, result: result ?? null });
        },
        (error: unknown) => {
          if (id !== undefined) channel.send({ jsonrpc: '2.0', id, error: safeError(error) });
        },
      )
      .catch(() => channel.close());
  });
}

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
