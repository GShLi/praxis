import { assert, PraxisError } from '@praxis/contracts';

export interface OutputChunk {
  sequence: number;
  start: number;
  stream: 'stdout' | 'stderr';
  text: string;
}

export function utf8Prefix(buffer: Buffer, maximum: number) {
  let length = Math.min(buffer.length, maximum);
  while (length > 0 && length < buffer.length && (buffer[length]! & 0xc0) === 0x80) length--;
  return length;
}

function cursorOffset(cursor: string | undefined, executionId: string, total: number) {
  if (cursor === undefined) return 0;
  try {
    assert(cursor.length <= 256, 'OUTPUT_CURSOR_INVALID', '命令输出游标无效。');
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    assert(
      value &&
        value.v === 1 &&
        value.id === executionId &&
        Number.isSafeInteger(value.offset) &&
        value.offset >= 0 &&
        value.offset <= total,
      'OUTPUT_CURSOR_INVALID',
      '命令输出游标不属于此执行或已失效。',
    );
    return Number(value.offset);
  } catch {
    throw new PraxisError('OUTPUT_CURSOR_INVALID', '命令输出游标无效。');
  }
}

export function outputPage(
  executionId: string,
  retained: OutputChunk[],
  totalBytes: number,
  outputTruncated: boolean,
  cursor: string | undefined,
  maxBytes: number,
) {
  assert(
    Number.isInteger(maxBytes) && maxBytes >= 1 && maxBytes <= 65536,
    'INVALID_ARGUMENT',
    '命令输出读取上限应为 1–65536 字节。',
  );
  let offset = cursorOffset(cursor, executionId, totalBytes),
    budget = maxBytes;
  const chunks: OutputChunk[] = [],
    gaps: Array<{ from: number; to: number }> = [];
  for (const chunk of retained) {
    const bytes = Buffer.from(chunk.text),
      end = chunk.start + bytes.length;
    if (end <= offset) continue;
    if (!budget) break;
    if (chunk.start > offset) {
      gaps.push({ from: offset, to: chunk.start });
      offset = chunk.start;
    }
    const start = offset - chunk.start;
    assert((bytes[start]! & 0xc0) !== 0x80, 'OUTPUT_CURSOR_INVALID', '游标不在完整字符边界。');
    const count = utf8Prefix(bytes.subarray(start), budget);
    if (!count) {
      assert(chunks.length > 0, 'OUTPUT_PAGE_TOO_SMALL', '读取上限不足以容纳下一个完整字符。');
      break;
    }
    chunks.push({
      ...chunk,
      start: offset,
      text: bytes.subarray(start, start + count).toString('utf8'),
    });
    offset += count;
    budget -= count;
    if (offset < end) break;
  }
  return {
    chunks,
    gaps,
    outputTruncated,
    totalBytes,
    nextCursor: Buffer.from(JSON.stringify({ v: 1, id: executionId, offset })).toString(
      'base64url',
    ),
    hasMore: offset < totalBytes,
  };
}
