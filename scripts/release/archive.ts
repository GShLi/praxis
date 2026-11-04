import path from 'node:path';

export function tarExecutable(
  platform: NodeJS.Platform = process.platform,
  systemRoot: string | undefined = process.env.SystemRoot,
): string {
  if (platform !== 'win32') return 'tar';
  if (!systemRoot || !path.win32.isAbsolute(systemRoot))
    throw new Error('Windows release archives require an absolute SystemRoot');
  // Git Bash GNU tar treats drive letters as remote hosts; bypass PATH on Windows.
  return path.win32.join(systemRoot, 'System32', 'tar.exe');
}
