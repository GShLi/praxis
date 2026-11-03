import { copyFile, mkdir, readFile, realpath, symlink } from 'node:fs/promises';
import path from 'node:path';
import { buildNode } from '../../scripts/build-node.ts';

/** Caller owns the temporary root. No workspace packages or TypeScript loader are linked. */
export async function cliDistribution(root: string) {
  const directory = path.join(root, 'distribution');
  await buildNode(path.join(directory, 'dist/node'));
  const manifest: { dependencies: Record<string, string> } = JSON.parse(
    await readFile('package.json', 'utf8'),
  );
  for (const name of Object.keys(manifest.dependencies)) {
    const target = path.join(directory, 'node_modules', name);
    await mkdir(path.dirname(target), { recursive: true });
    await symlink(await realpath(path.join('node_modules', name)), target, 'junction');
  }
  await mkdir(path.join(directory, 'build/native'), { recursive: true });
  const helpers = ['praxis-lease', 'praxis-files'];
  if (process.platform !== 'linux') helpers.push('praxis-secret');
  for (const name of helpers) {
    const executable = name + (process.platform === 'win32' ? '.exe' : '');
    await copyFile(
      path.join('build/native', executable),
      path.join(directory, 'build/native', executable),
    );
  }
  return path.join(directory, 'dist/node/cli.mjs');
}
