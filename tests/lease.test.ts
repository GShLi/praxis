import { acquireLease } from '@praxis/workspace';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

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

test('workspace leases exclude nested roots and aliases but allow siblings', async () => {
  const { mkdir, symlink } = await import('node:fs/promises');
  const { acquireWorkspaceLease } = await import('@praxis/workspace');
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-overlap-'));
  const work = path.join(root, 'work'),
    child = path.join(work, 'child'),
    sibling = path.join(root, 'other');
  await mkdir(child, { recursive: true });
  await mkdir(sibling);
  await symlink(work, path.join(root, 'alias'), 'junction');
  const locks = path.join(root, 'locks'),
    signal = new AbortController().signal;
  const leases: Awaited<ReturnType<typeof acquireWorkspaceLease>>[] = [];
  try {
    leases.push(await acquireWorkspaceLease(work, locks, signal));
    await assert.rejects(acquireWorkspaceLease(child, locks, signal), /另一个客户端/);
    await assert.rejects(
      acquireWorkspaceLease(path.join(root, 'alias'), locks, signal),
      /另一个客户端/,
    );
    leases.push(await acquireWorkspaceLease(sibling, locks, signal));
    await leases.shift()!.release();
    leases.push(await acquireWorkspaceLease(child, locks, signal));
    await assert.rejects(acquireWorkspaceLease(work, locks, signal), /另一个客户端/);
  } finally {
    await Promise.all(leases.map((v) => v.release()));
    await rm(root, { recursive: true, force: true });
  }
});
