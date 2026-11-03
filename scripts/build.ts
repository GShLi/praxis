import { build } from 'esbuild';
import { build as buildWeb } from 'vite';
import { workspaceBundles } from './workspace-bundles.ts';
import { buildNode } from './build-node.ts';

await buildWeb({ configFile: 'apps/web/vite.config.ts' });
await buildNode();
await build({
  plugins: [workspaceBundles()],
  entryPoints: { main: 'apps/desktop/src/main.ts' },
  outdir: 'dist/desktop',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outExtension: { '.js': '.mjs' },
  packages: 'external',
  sourcemap: true,
});
await build({
  plugins: [workspaceBundles()],
  entryPoints: { preload: 'apps/desktop/src/preload.ts' },
  outdir: 'dist/desktop',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outExtension: { '.js': '.cjs' },
  external: ['electron'],
  sourcemap: true,
});
