import type { Plugin } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Bundle public workspace exports while leaving installed third-party packages external. */
export function workspaceBundles(): Plugin {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const entries = new Map<string, string>();
  for (const directory of readdirSync(path.join(root, 'packages'))) {
    const folder = path.join(root, 'packages', directory);
    const manifest: { name: string; exports: string | Record<string, string> } = JSON.parse(
      readFileSync(path.join(folder, 'package.json'), 'utf8'),
    );
    const exported =
      typeof manifest.exports === 'string' ? { '.': manifest.exports } : manifest.exports;
    for (const [subpath, target] of Object.entries(exported))
      entries.set(
        manifest.name + (subpath === '.' ? '' : subpath.slice(1)),
        path.resolve(folder, target),
      );
  }
  return {
    name: 'praxis-workspace',
    setup(build) {
      build.onResolve({ filter: /^@praxis\// }, (args) => {
        const target = entries.get(args.path);
        return target
          ? { path: target }
          : { errors: [{ text: `Workspace subpath is not public: ${args.path}` }] };
      });
    },
  };
}
