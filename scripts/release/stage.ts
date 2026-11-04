import { writeDistributionMetadata } from './metadata.ts';
import { copyFile, cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tarExecutable } from './archive.ts';
import { copyDependencies } from './dependencies.ts';
import { artifacts, nativeNames, platform, projectManifest, stage } from './layout.ts';
import { run } from './process.ts';

async function stageApplication(kind: 'cli' | 'server' | 'desktop') {
  const root = path.join(stage, kind);
  const project = await projectManifest();
  await mkdir(path.join(root, 'dist/node'), { recursive: true });
  const entries =
    kind === 'server' ? ['server'] : ['host', 'backup-worker', ...(kind === 'cli' ? ['cli'] : [])];
  for (const entry of entries)
    await copyFile(`dist/node/${entry}.mjs`, path.join(root, `dist/node/${entry}.mjs`));
  if (kind !== 'cli') await cp('dist/web', path.join(root, 'dist/web'), { recursive: true });
  if (kind === 'desktop') {
    await mkdir(path.join(root, 'dist/desktop'), { recursive: true });
    for (const file of ['main.mjs', 'preload.cjs'])
      await copyFile(`dist/desktop/${file}`, path.join(root, 'dist/desktop', file));
  }
  if (kind !== 'server') {
    await mkdir(path.join(root, 'build/native'), { recursive: true });
    for (const file of nativeNames())
      await copyFile(`build/native/${file}`, path.join(root, 'build/native', file));
  }
  const inventory = await copyDependencies('.', root, Object.keys(project.dependencies));
  await writeFile(path.join(root, 'dependencies.json'), JSON.stringify(inventory, null, 2));
  await writeDistributionMetadata(kind, root, project);
}

export async function archiveApplications() {
  const { version } = await projectManifest();
  for (const kind of ['cli', 'server']) {
    const filename = `praxis-${kind}-${version}-${platform}.tar.gz`;
    await run(tarExecutable(), ['-czf', path.join(artifacts, filename), '-C', stage, kind], {
      timeout: 300000,
    });
  }
}
export async function stageRelease() {
  await rm(stage, { recursive: true, force: true });
  await rm(artifacts, { recursive: true, force: true });
  await mkdir(artifacts, { recursive: true });
  for (const kind of ['cli', 'server', 'desktop'] as const) await stageApplication(kind);
  await archiveApplications();
  console.log(`Staged ${platform} runtime distributions at ${stage}`);
}
