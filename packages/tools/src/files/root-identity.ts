import { open, stat } from 'node:fs/promises';

/** Match the identity returned by the native file helper, without losing inode precision. */
export function nativeRootIdentity(
  stat: { dev: bigint; ino: bigint },
  platform: NodeJS.Platform = process.platform,
): string {
  // Older libuv reports the 64-bit Windows volume serial; GetFileInformationByHandle
  // (and newer libuv) uses its low DWORD. Keep that full DWORD and the full file index.
  // https://github.com/libuv/libuv/commit/82cdfb75f
  const device = platform === 'win32' ? BigInt.asUintN(32, stat.dev) : stat.dev;
  return `${device}:${stat.ino}`;
}
/** Read the real directory handle: old Windows libuv path-stat has an incorrect ABI layout. */
export async function readWorkspaceRootStat(directory: string) {
  if (process.platform !== 'win32') return stat(directory, { bigint: true });
  // https://github.com/libuv/libuv/commit/abe59d6319973cbff0686f41869cf8ae50bab1d2
  const handle = await open(directory, 'r');
  try {
    return await handle.stat({ bigint: true });
  } finally {
    await handle.close();
  }
}
