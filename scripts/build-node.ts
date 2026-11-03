import { build } from 'esbuild';
import { workspaceBundles } from './workspace-bundles.ts';

/** Shared by application builds and tests of the relocated distribution layout. */
export function buildNode(outdir = 'dist/node') {
  return build({
    plugins: [workspaceBundles()],
    entryPoints: {
      host: 'apps/agent-host/src/main.ts',
      cli: 'apps/cli/src/main.ts',
      server: 'apps/server/src/main.ts',
      'backup-worker': 'packages/storage-local/src/backup/worker-main.ts',
    },
    outdir,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    outExtension: { '.js': '.mjs' },
    packages: 'external',
    sourcemap: true,
  });
}
