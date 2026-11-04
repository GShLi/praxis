import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { projectManifest } from './layout.ts';

export async function writeDistributionMetadata(
  kind: 'cli' | 'server' | 'desktop',
  root: string,
  project: Awaited<ReturnType<typeof projectManifest>>,
) {
  const manifest = {
    name: `praxis-${kind}`,
    version: project.version,
    private: true,
    type: 'module',
    description: '知行 Praxis',
    author: 'Praxis contributors',
    license: 'UNLICENSED',
    main: kind === 'desktop' ? 'dist/desktop/main.mjs' : `dist/node/${kind}.mjs`,
    dependencies: project.dependencies,
    engines: project.engines,
    ...(kind === 'cli' ? { bin: { praxis: 'bin/praxis.cjs' } } : {}),
  };
  await writeFile(path.join(root, 'package.json'), JSON.stringify(manifest, null, 2));
  if (kind === 'cli') {
    await mkdir(path.join(root, 'bin'), { recursive: true });
    await writeFile(
      path.join(root, 'bin/praxis.cjs'),
      '#!/usr/bin/env node\nconst {spawnSync}=require("node:child_process");\nconst path=require("node:path");\nconst result=spawnSync(process.execPath,[path.join(__dirname,"../dist/node/cli.mjs"),...process.argv.slice(2)],{stdio:"inherit"});\nif(result.error) console.error(result.error.message);\nprocess.exitCode=result.status ?? 1;\n',
    );
    await chmod(path.join(root, 'bin/praxis.cjs'), 0o755);
  }
  if (kind === 'server') await copyFile('.env.example', path.join(root, '.env.example'));
  await writeFile(
    path.join(root, 'INSTALL.txt'),
    kind === 'cli'
      ? 'Requires Node.js 22.15.x–22.x or 24+. Run node bin/praxis.cjs --help; node bin/praxis.cjs doctor. Keep the whole extracted directory. Linux credential storage additionally needs secret-tool and a running Secret Service.\n'
      : 'See https://github.com/GShLi/praxis/blob/HEAD/docs/releasing.md for installation, configuration and backups.\n',
  );
}
