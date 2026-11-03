import { assert } from '@praxis/contracts';
import { StringDecoder } from 'node:string_decoder';
import { z } from 'zod';
import { outputPage, utf8Prefix, type OutputChunk } from './output-page.ts';

export const outputChunksSchema = z
  .array(
    z.strictObject({
      sequence: z.number().int().nonnegative(),
      start: z.number().int().nonnegative(),
      stream: z.enum(['stdout', 'stderr']),
      text: z.string().max(8192),
    }),
  )
  .max(4096);

const snapshotSchema = z.strictObject({
  version: z.literal(1),
  totalBytes: z.number().int().nonnegative(),
  outputTruncated: z.boolean(),
  chunks: outputChunksSchema,
});

/** Per-execution UTF-8 transcript. Head/tail and chunk counts both remain bounded. */
export class ProcessOutput {
  private head: OutputChunk[] = [];
  private tail: OutputChunk[] = [];
  private headBytes = 0;
  private headClosed = false;
  private tailBytes = 0;
  private totalBytes = 0;
  private sequence = 0;
  private truncated = false;
  private ended = false;
  private decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
  constructor(
    private executionId: string,
    private maxBytes = 20 * 1024 * 1024,
  ) {
    assert(
      executionId.length <= 128 && executionId.length > 0,
      'INVALID_ARGUMENT',
      '执行标识无效。',
    );
    assert(
      Number.isInteger(maxBytes) && maxBytes >= 16 && maxBytes <= 20 * 1024 * 1024,
      'INVALID_ARGUMENT',
      '命令输出存储上限无效。',
    );
  }
  append(stream: 'stdout' | 'stderr', bytes: Buffer) {
    assert(!this.ended, 'EXECUTION_FINISHED', '命令输出已经关闭。');
    const previous = this.head.length;
    this.capture(stream, this.decoders[stream].write(bytes));
    return structuredClone(this.head.slice(previous));
  }
  end() {
    if (this.ended) return [];
    const previous = this.head.length;
    for (const stream of ['stdout', 'stderr'] as const)
      this.capture(stream, this.decoders[stream].end());
    this.ended = true;
    return structuredClone(this.head.slice(previous));
  }
  private capture(stream: 'stdout' | 'stderr', text: string) {
    const bytes = Buffer.from(text),
      headLimit = Math.floor(this.maxBytes / 2);
    for (let offset = 0; offset < bytes.length; ) {
      const available =
        !this.headClosed && this.head.length < 2048 ? headLimit - this.headBytes : 0;
      const headSize =
        available > 0 ? utf8Prefix(bytes.subarray(offset), Math.min(8192, available)) : 0;
      const size = headSize || utf8Prefix(bytes.subarray(offset), 8192);
      const chunk = {
        sequence: this.sequence++,
        start: this.totalBytes,
        stream,
        text: bytes.subarray(offset, offset + size).toString('utf8'),
      };
      this.totalBytes += size;
      offset += size;
      if (headSize) {
        this.head.push(chunk);
        this.headBytes += size;
      } else {
        this.headClosed = true;
        this.tail.push(chunk);
        this.tailBytes += size;
        this.trimTail();
      }
    }
  }
  private trimTail() {
    const limit = this.maxBytes - this.headBytes;
    while (this.tail.length > 2048 || this.tailBytes > limit) {
      const first = this.tail[0]!,
        bytes = Buffer.from(first.text);
      let drop =
        this.tail.length > 2048 ? bytes.length : Math.min(bytes.length, this.tailBytes - limit);
      while (drop < bytes.length && (bytes[drop]! & 0xc0) === 0x80) drop++;
      this.truncated = true;
      this.tailBytes -= drop;
      if (drop === bytes.length) this.tail.shift();
      else {
        first.start += drop;
        first.text = bytes.subarray(drop).toString('utf8');
      }
    }
  }
  read(cursor?: string, maxBytes = 16384) {
    return outputPage(
      this.executionId,
      [...this.head, ...this.tail],
      this.totalBytes,
      this.truncated,
      cursor,
      maxBytes,
    );
  }
  snapshot() {
    return {
      version: 1 as const,
      totalBytes: this.totalBytes,
      outputTruncated: this.truncated,
      chunks: structuredClone([...this.head, ...this.tail]),
    };
  }
  tailSnapshot() {
    return {
      version: 1 as const,
      totalBytes: this.totalBytes,
      outputTruncated: this.truncated,
      chunks: structuredClone(this.tail),
    };
  }
  static restore(executionId: string, raw: unknown) {
    const result = snapshotSchema.safeParse(raw);
    assert(result.success, 'OUTPUT_SNAPSHOT_INVALID', '命令输出快照无效。');
    const output = new ProcessOutput(executionId);
    let end = 0,
      sequence = -1,
      bytes = 0;
    for (const chunk of result.data.chunks) {
      const size = Buffer.byteLength(chunk.text);
      assert(
        size > 0 && size <= 8192 && chunk.start >= end && chunk.sequence > sequence,
        'OUTPUT_SNAPSHOT_INVALID',
        '命令输出快照区间无效。',
      );
      end = chunk.start + size;
      sequence = chunk.sequence;
      bytes += size;
    }
    assert(
      end === result.data.totalBytes &&
        bytes <= 20 * 1024 * 1024 &&
        (result.data.outputTruncated || bytes === end),
      'OUTPUT_SNAPSHOT_INVALID',
      '命令输出快照长度无效。',
    );
    output.head = result.data.chunks;
    output.totalBytes = result.data.totalBytes;
    output.truncated = result.data.outputTruncated;
    output.ended = true;
    return output;
  }
}
