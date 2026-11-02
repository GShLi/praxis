import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { acquireLease } from '../packages/workspace/src/index.ts';

test('OS lease excludes a second process and becomes available after pipe closes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'praxis-lock-'));
  let first: Awaited<ReturnType<typeof acquireLease>> | undefined;
  try {
    const file = path.join(directory, 'test.lock');
    first = await acquireLease(file);
    await assert.rejects(acquireLease(file), /另一个客户端/);
    await first.release();
    first = undefined;
    const second = await acquireLease(file);
    await second.release();
  } finally {
    await first?.release();
    await rm(directory, { recursive: true, force: true });
  }
});
