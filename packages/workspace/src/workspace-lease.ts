import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { defaultLeaseExecutable } from './lease-path.ts';
import { acquireLease } from './lease.ts';

/** Shared ancestors + exclusive root exclude nested/aliased writers without blocking siblings. */
export async function acquireWorkspaceLease(root: string, directory: string, signal: AbortSignal) {
  const canonical = await realpath(root);
  const ancestors: string[] = [];
  for (let current = canonical; ; current = path.dirname(current)) {
    ancestors.unshift(current);
    if (path.dirname(current) === current) break;
  }
  const leases: Awaited<ReturnType<typeof acquireLease>>[] = [];
  try {
    for (const target of ancestors) {
      signal.throwIfAborted();
      const info = await stat(target);
      const identity = `${info.dev}:${info.ino}:${process.platform === 'win32' ? target.toLowerCase() : ''}`;
      const name = createHash('sha256').update(identity).digest('hex') + '.lock';
      leases.push(
        await acquireLease(
          path.join(directory, name),
          defaultLeaseExecutable,
          target !== canonical,
        ),
      );
    }
    signal.throwIfAborted();
  } catch (error) {
    await Promise.all(leases.map((lease) => lease.release()));
    throw error;
  }
  return {
    onLost(callback: () => void) {
      for (const lease of leases) lease.onLost(callback);
    },
    async release() {
      await Promise.all(leases.map((lease) => lease.release()));
    },
  };
}
