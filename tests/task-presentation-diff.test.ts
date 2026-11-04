import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DiffModule, DiffPresentation, FileModule } from './task-presentation-contracts.ts';
const { lineDiff, diffLimits }: DiffModule = await import(
  new URL('../packages/ui/src/conversation/line-diff.ts', import.meta.url).href
);
const { diffRows, diffLineText }: DiffPresentation = await import(
  new URL('../packages/ui/src/conversation/diff-presentation.ts', import.meta.url).href
);
const { parseFileChangeArtifact }: FileModule = await import(
  new URL('../packages/ui/src/conversation/file-change.ts', import.meta.url).href
);

function reconstruct(before: string | null, after: string) {
  const diff = lineDiff(before, after);
  assert.equal(
    diff.lines
      .filter((line) => line.kind !== 'add')
      .map((line) => line.raw)
      .join(''),
    before ?? '',
  );
  assert.equal(
    diff.lines
      .filter((line) => line.kind !== 'remove')
      .map((line) => line.raw)
      .join(''),
    after,
  );
  assert.deepEqual(
    diff.lines.flatMap((line) => (line.beforeLine === null ? [] : [line.beforeLine])),
    Array.from(
      { length: diff.lines.filter((line) => line.kind !== 'add').length },
      (_, i) => i + 1,
    ),
  );
  assert.deepEqual(
    diff.lines.flatMap((line) => (line.afterLine === null ? [] : [line.afterLine])),
    Array.from(
      { length: diff.lines.filter((line) => line.kind !== 'remove').length },
      (_, i) => i + 1,
    ),
  );
  return diff;
}

test('inserting a line preserves aligned subsequent context and both line numbers', () => {
  const diff = reconstruct('a\nb\nc\n', 'a\nnew\nb\nc\n');
  assert.equal(diff.additions, 1);
  assert.equal(diff.deletions, 0);
  assert.deepEqual(
    diff.lines.map((line) => [line.kind, line.beforeLine, line.afterLine]),
    [
      ['context', 1, 1],
      ['add', null, 2],
      ['context', 2, 3],
      ['context', 3, 4],
    ],
  );
});

test('replacement, deletion and repeated lines retain meaningful common lines', () => {
  const replacement = reconstruct('same\nx\nsame\nz\n', 'same\nsame\ny\nz\n');
  assert.equal(replacement.additions, 1);
  assert.equal(replacement.deletions, 1);
  assert.equal(replacement.lines.filter((line) => line.kind === 'context').length, 3);
  const removed = reconstruct('a\nb\nc\n', 'a\nc\n');
  assert.equal(removed.additions, 0);
  assert.equal(removed.deletions, 1);
});

test('empty files, blank lines, Unicode, CRLF and EOF newline changes round-trip exactly', () => {
  const samples = ['', '\n', '\n\n', 'a', 'a\n', 'a\r\n', '😀\n中文', 'x\nx\n', 'x\ny\nx\n'];
  for (const before of [null, ...samples]) for (const after of samples) reconstruct(before, after);
  assert.equal(lineDiff(null, '').additions, 0);
  assert.equal(lineDiff(null, 'a\n').additions, 1);
  assert.deepEqual([lineDiff('a', 'a\n').additions, lineDiff('a', 'a\n').deletions], [1, 1]);
  assert.equal(diffLineText('a\r\n').ending, 'CRLF');
  assert.equal(diffLineText('a').ending, 'none');
});

test('small randomized diffs use a minimal insert/delete script', () => {
  let seed = 17;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed;
  };
  for (let attempt = 0; attempt < 100; attempt++) {
    const a = Array.from({ length: next() % 9 }, () => `${next() % 4}\n`);
    const b = Array.from({ length: next() % 9 }, () => `${next() % 4}\n`);
    const costs = Array.from({ length: a.length + 1 }, (_, i) =>
      Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
    );
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++) {
        costs[i]![j] =
          a[i - 1] === b[j - 1]
            ? costs[i - 1]![j - 1]!
            : 1 + Math.min(costs[i - 1]![j]!, costs[i]![j - 1]!);
      }
    const diff = reconstruct(a.join(''), b.join(''));
    assert.equal(diff.additions + diff.deletions, costs[a.length]![b.length]);
  }
});

test('large identical surroundings are folded without hiding a small change', () => {
  const lines = Array.from({ length: 11000 }, (_, i) => `line ${i}\n`);
  const after = [...lines];
  after[8000] = 'changed\n';
  const diff = reconstruct(lines.join(''), after.join(''));
  assert.equal(diff.coarse, false);
  assert.equal(diff.additions, 1);
  assert.equal(diff.deletions, 1);
  const display = diffRows(diff);
  assert.ok(display.rows.length < 20);
  assert.ok(display.rows.some((row) => row.kind === 'add' && row.afterLine === 8001));
});

test('comparison work, source scans and rendered rows are bounded for huge changes', () => {
  const diff = reconstruct('a\n'.repeat(1100), 'b\n'.repeat(1100));
  assert.equal(diff.coarse, true);
  assert.equal(diffRows(diff).rows.length, diffLimits.displayRows);
  assert.ok(diffRows(diff).omittedRows > 0);
  const oversized = lineDiff('', 'x\n'.repeat(diffLimits.lines + 10));
  assert.equal(oversized.complete, false);
  assert.equal(oversized.lines.length, diffLimits.lines);
  const long = lineDiff('', 'x'.repeat(diffLimits.characters + 10));
  assert.equal(long.complete, false);
  assert.ok(long.lines[0]!.raw.length <= diffLimits.characters);
  assert.equal(diffLineText(long.lines[0]!.raw).truncated, true);
});

test('file-change decoding accepts immutable snapshots and rejects invalid artifact shapes', () => {
  const value = { path: '/project/file', before: null, after: '<script>not executed</script>' };
  assert.deepEqual(
    parseFileChangeArtifact({ kind: 'file-change', content: JSON.stringify(value) }),
    value,
  );
  for (const content of ['null', '{}', 'invalid', JSON.stringify({ ...value, before: 1 })])
    assert.throws(() => parseFileChangeArtifact({ kind: 'file-change', content }));
  assert.throws(() => parseFileChangeArtifact({ kind: 'text', content: JSON.stringify(value) }));
});
