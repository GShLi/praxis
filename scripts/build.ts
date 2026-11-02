import { build } from 'esbuild';
import { build as buildWeb } from 'vite';

await buildWeb({ configFile: 'apps/web/vite.config.ts' });
await build({
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
  entryPoints: { preload: 'apps/desktop/src/preload.ts' },
  outdir: 'dist/desktop',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  sourcemap: true,
});
