import path from 'node:path';
import { readFile } from 'node:fs/promises';

export const releaseRoot = path.resolve('out/release');
export const artifacts = path.join(releaseRoot, 'artifacts');
export const stage = path.join(releaseRoot, 'stage');
export const platform = `${process.platform}-${process.arch}`;
export async function projectManifest() {
  const value = JSON.parse(await readFile('package.json', 'utf8')) as {
    version: string;
    dependencies: Record<string, string>;
    engines: { node: string };
    devDependencies: Record<string, string>;
  };
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(value.version))
    throw new Error('Invalid release version');
  return value;
}
export function nativeNames() {
  return [
    'praxis-lease',
    'praxis-files',
    ...(process.platform === 'linux' ? [] : ['praxis-secret']),
  ].map((name) => name + (process.platform === 'win32' ? '.exe' : ''));
}
export function desktopAppRoot() {
  return process.platform === 'darwin'
    ? path.join(
        releaseRoot,
        'desktop',
        `mac${process.arch === 'arm64' ? '-arm64' : ''}`,
        'Praxis.app',
      )
    : path.join(
        releaseRoot,
        'desktop',
        process.platform === 'win32' ? 'win-unpacked' : 'linux-unpacked',
      );
}
export function desktopExecutable() {
  const root = desktopAppRoot();
  return path.join(
    root,
    process.platform === 'darwin'
      ? 'Contents/MacOS/Praxis'
      : process.platform === 'win32'
        ? 'Praxis.exe'
        : 'praxis',
  );
}
export function desktopResources() {
  return path.join(
    desktopAppRoot(),
    process.platform === 'darwin' ? 'Contents/Resources/app' : 'resources/app',
  );
}
