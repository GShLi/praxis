import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { structurePath } from './paths.ts';
export interface Manifest {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports?: Record<string, string>;
}
export interface Package {
  directory: string;
  manifest: Manifest;
}
export function files(directory: string): string[] {
  directory = structurePath(directory);
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist', 'build', '.cache', '.git'].includes(entry.name)) return [];
    const file = structurePath(path.join(directory, entry.name));
    return entry.isDirectory() ? files(file) : [file];
  });
}
export function packages(): Package[] {
  return [
    '.',
    ...['apps', 'packages'].flatMap((root) =>
      readdirSync(root).map((name) => path.join(root, name)),
    ),
  ]
    .filter((directory) => existsSync(path.join(directory, 'package.json')))
    .map((directory) => ({
      directory: structurePath(directory),
      manifest: JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')) as Manifest,
    }));
}
export function owner(file: string, workspace: Package[]) {
  file = structurePath(file);
  return (
    workspace.find(
      (item) => item.directory !== '.' && file.startsWith(structurePath(item.directory) + '/'),
    ) ?? workspace[0]!
  );
}
export function sourceFiles() {
  return ['apps', 'packages', 'scripts', 'tests', 'native']
    .flatMap(files)
    .filter((file) => /\.(tsx?|css|c|m)$/.test(file));
}
