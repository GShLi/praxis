import { ProcessOutput } from '@praxis/tools/processes';
import assert from 'node:assert/strict';
import test from 'node:test';

test('command output keeps stream order, split UTF-8 and independently repeatable cursors', () => {
  const output = new ProcessOutput('execution-one', 1024);
  const text = Buffer.from('你好');
  output.append('stdout', text.subarray(0, 2));
  output.append('stdout', text.subarray(2));
  output.append('stderr', Buffer.from('warning'));
  output.end();
  const first = output.read(undefined, 6);
  assert.deepEqual(
    first.chunks.map((c) => [c.stream, c.text]),
    [['stdout', '你好']],
  );
  assert.deepEqual(output.read(undefined, 6), first);
  const second = output.read(first.nextCursor, 100);
  assert.deepEqual(
    second.chunks.map((c) => [c.stream, c.text]),
    [['stderr', 'warning']],
  );
  assert.equal(second.hasMore, false);
  assert.equal(output.read(second.nextCursor, 100).chunks.length, 0);
  assert.throws(() => new ProcessOutput('another', 1024).read(first.nextCursor, 100), {
    code: 'OUTPUT_CURSOR_INVALID',
  });
});

test('bounded command output retains a head and recent tail and reports skipped byte ranges', () => {
  const output = new ProcessOutput('bounded', 32);
  output.append('stdout', Buffer.from('0123456789abcdef'));
  const first = output.read(undefined, 16);
  output.append('stderr', Buffer.from('x'.repeat(100000)));
  output.append('stdout', Buffer.from('最近尾部'));
  output.end();
  const result = output.read(first.nextCursor, 64);
  assert.equal(result.outputTruncated, true);
  assert(result.gaps.length > 0);
  assert(
    result.chunks
      .map((c) => c.text)
      .join('')
      .endsWith('最近尾部'),
  );
  assert(Buffer.byteLength(JSON.stringify(output.snapshot())) < 2048);
  const restored = ProcessOutput.restore('bounded', output.snapshot());
  assert.deepEqual(restored.read(first.nextCursor, 64), result);
});

test('command output rejects invalid offsets and too-small UTF-8 pages without splitting characters', () => {
  const output = new ProcessOutput('unicode', 64);
  output.append('stdout', Buffer.from('界'));
  assert.throws(() => output.read(undefined, 1), { code: 'OUTPUT_PAGE_TOO_SMALL' });
  assert.throws(() => output.read('not-a-cursor', 10), { code: 'OUTPUT_CURSOR_INVALID' });
  assert.throws(() => ProcessOutput.restore('unicode', { chunks: [], totalBytes: -1 }), {
    code: 'OUTPUT_SNAPSHOT_INVALID',
  });
});

test('a multi-byte character crossing the head boundary cannot reorder later ASCII output', () => {
  const output = new ProcessOutput('boundary', 16);
  output.append('stdout', Buffer.from('1234567'));
  output.append('stdout', Buffer.from('界'));
  output.append('stderr', Buffer.from('x'));
  output.end();
  assert.equal(
    output
      .read(undefined, 64)
      .chunks.map((chunk) => chunk.text)
      .join(''),
    '1234567界x',
  );
});
