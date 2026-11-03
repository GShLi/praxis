import { WorkspaceFiles } from '@praxis/tools/files';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'praxis-search-'));
  const files = await WorkspaceFiles.open(root, () => 'unused');
  return { root, files, cleanup: () => rm(root, { recursive: true, force: true }) };
}
const options = {
  path: '.',
  syntax: 'regex' as const,
  include: [],
  caseSensitive: true,
  includeHidden: false,
  respectIgnore: true,
  contextLines: 1,
  limit: 100,
};

test('single-line regex honors Unicode columns, ignores and context without executing source', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, 'index.ts'), 'before\n😀 const HelloWorld = 42;\nafter\n');
    await writeFile(path.join(f.root, '.gitignore'), 'ignored/\n');
    await mkdir(path.join(f.root, 'ignored'));
    await writeFile(path.join(f.root, 'ignored', 'secret.ts'), 'const HelloWorld = 42;');
    const result = await f.files.search(
      { ...options, query: 'Hello\\w+\\s*=\\s*\\d+' },
      new AbortController().signal,
    );
    assert.equal(result.incomplete, false);
    assert.equal(result.matches.length, 1);
    assert.deepEqual(result.matches[0], {
      path: 'index.ts',
      line: 2,
      column: 9,
      text: '😀 const HelloWorld = 42;',
      lineTruncated: false,
      contextBefore: ['before'],
      contextAfter: ['after'],
    });
    const literal = await f.files.search(
      { ...options, syntax: 'literal', query: 'HelloWorld' },
      new AbortController().signal,
    );
    assert.deepEqual(literal.matches, result.matches);
  } finally {
    await f.cleanup();
  }
});

test('regex errors are explicit and zero-width results remain bounded', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, 'text.txt'), 'a\nb\nc');
    await assert.rejects(f.files.search({ ...options, query: '[' }, new AbortController().signal), {
      code: 'INVALID_SEARCH_PATTERN',
    });
    const result = await f.files.search(
      { ...options, query: '^', limit: 2 },
      new AbortController().signal,
    );
    assert.equal(result.matches.length, 2);
    assert.equal(result.truncated, true);
  } finally {
    await f.cleanup();
  }
});

test('pathological regex is cancelled without blocking the Host event loop', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, 'text.txt'), 'a'.repeat(200000) + '!');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('cancel search')), 100);
    const started = Date.now();
    try {
      await assert.rejects(
        f.files.search({ ...options, query: '^(a+)+$' }, controller.signal),
        /cancel search/,
      );
      assert.ok(Date.now() - started < 2000);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await f.cleanup();
  }
});

test('literal metacharacters stay literal and runaway regex reaches the per-file deadline', async () => {
  const f = await fixture();
  try {
    const query = '[]{}()*+?.\\^$|';
    await writeFile(path.join(f.root, 'text.txt'), query);
    const literal = await f.files.search(
      { ...options, syntax: 'literal', query },
      new AbortController().signal,
    );
    assert.equal(literal.matches.length, 1);
    await writeFile(path.join(f.root, 'text.txt'), 'a'.repeat(200000) + '!');
    await assert.rejects(
      f.files.search({ ...options, query: '^(a+)+$' }, new AbortController().signal),
      { code: 'SEARCH_TIMEOUT' },
    );
  } finally {
    await f.cleanup();
  }
});
