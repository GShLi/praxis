import { build } from 'esbuild';
import { build as buildWeb } from 'vite';
import { workspaceBundles } from './workspace-bundles.ts';

await buildWeb({ configFile: 'apps/web/vite.config.ts' });
await build({
  plugins: [workspaceBundles()],
  entryPoints: {
    host: 'apps/agent-host/src/main.ts',
    cli: 'apps/cli/src/main.ts',
    server: 'apps/server/src/main.ts',
  },
  outdir: 'dist/node',
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
  external: ['electron'],
  sourcemap: true,
});
