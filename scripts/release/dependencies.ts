import { cp, mkdir, readFile, realpath, stat, lstat } from 'node:fs/promises';
import path from 'node:path';

interface Manifest {
  name: string;
  version: string;
  license?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}
export interface DependencyRecord {
  name: string;
  version: string;
  license: string;
}

async function resolvePackage(from: string, name: string): Promise<string | undefined> {
  if (!/^(@[\w.-]+\/)?[\w.-]+$/.test(name)) throw new Error('Invalid dependency name');
  let directory = from;
  for (;;) {
    const candidate = path.join(directory, 'node_modules', name);
    try {
      await stat(path.join(candidate, 'package.json'));
      return await realpath(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

/** Materialize the installed lockfile graph; no symlinks or developer paths survive. */
export async function copyDependencies(source: string, destination: string, names: string[]) {
  const records = new Map<string, DependencyRecord>();
  async function copy(
    from: string,
    into: string,
    name: string,
    ancestors: Set<string>,
    optional = false,
  ): Promise<void> {
    const resolved = await resolvePackage(from, name);
    if (!resolved) {
      if (optional) return;
      throw new Error(`Missing production dependency: ${name}`);
    }
    if (ancestors.has(resolved)) return; // Node resolves this cycle from the ancestor's node_modules.
    const manifest: Manifest = JSON.parse(
      await readFile(path.join(resolved, 'package.json'), 'utf8'),
    );
    if (manifest.name.startsWith('@praxis/')) throw new Error('Unbundled workspace dependency');
    const target = path.join(into, 'node_modules', name);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(resolved, target, {
      recursive: true,
      dereference: true,
      filter: async (file) => {
        if (path.relative(resolved, file).split(path.sep).includes('node_modules')) return false;
        if ((await lstat(file)).isSymbolicLink())
          throw new Error('Dependency contains an unreviewed symlink');
        return true;
      },
    });
    records.set(`${manifest.name}@${manifest.version}`, {
      name: manifest.name,
      version: manifest.version,
      license: manifest.license ?? 'SEE PACKAGE LICENSE',
    });
    const next = new Set([...ancestors, resolved]);
    const optionalNames = manifest.optionalDependencies ?? {};
    const children = { ...manifest.dependencies, ...optionalNames };
    for (const child of Object.keys(children))
      await copy(resolved, target, child, next, child in optionalNames);
  }
  for (const name of names) await copy(path.resolve(source), destination, name, new Set());
  return [...records.values()].sort((a, b) => a.name.localeCompare(b.name));
}
