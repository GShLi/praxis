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
