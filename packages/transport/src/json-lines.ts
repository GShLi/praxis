import { MAX_FRAME_BYTES, PraxisError } from '@praxis/contracts';
import { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';

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
