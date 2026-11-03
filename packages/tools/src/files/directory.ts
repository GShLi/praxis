import { realpath } from 'node:fs/promises';
import type { WorkspacePathPolicy } from './policy.ts';

export async function readDirectory(
  paths: WorkspacePathPolicy,
  target: string,
  signal?: AbortSignal,
) {
  const real = await realpath(target);
  await paths.resolve(real);
  return paths.io.list(real, signal);
}
