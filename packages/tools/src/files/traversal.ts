import { PraxisError } from '@praxis/contracts';
import ignore from 'ignore';
import path from 'node:path';
import type { FileContent } from './content.ts';
import { sensitive, type WorkspacePathPolicy } from './policy.ts';
import { readDirectory } from './directory.ts';
type Rules = Array<{ root: string; matcher: ReturnType<typeof ignore> }>;
interface ScanInput {
  path: string;
  includeHidden: boolean;
  respectIgnore: boolean;
}

export async function scanFiles(
  paths: WorkspacePathPolicy,
  content: FileContent,
  input: ScanInput,
  signal: AbortSignal,
  observer?: (directory: string) => Promise<void>,
) {
  const root = await paths.resolve(input.path);
  const walk = new DirectoryWalk(paths, content, input, root, signal, observer);
  await walk.visit(root, []);
  return { root, files: walk.files, incomplete: walk.incomplete };
}
class DirectoryWalk {
  readonly files: string[] = [];
  incomplete = false;
  private scanned = 0;
  private deadline = Date.now() + 30000;
  constructor(
    private paths: WorkspacePathPolicy,
    private content: FileContent,
    private input: ScanInput,
    private root: string,
    private signal: AbortSignal,
    private observer?: (directory: string) => Promise<void>,
  ) {}
  private available() {
    this.signal.throwIfAborted();
    if (Date.now() <= this.deadline && this.scanned <= 20000) return true;
    this.incomplete = true;
    return false;
  }
  async visit(directory: string, rules: Rules) {
    if (!this.available()) return;
    try {
      await this.paths.resolve(directory);
    } catch {
      this.signal.throwIfAborted();
      this.incomplete = true;
      return;
    }
    await this.observer?.(directory);
    let listing;
    try {
      listing = await readDirectory(this.paths, directory, this.signal);
    } catch {
      this.signal.throwIfAborted();
      this.incomplete = true;
      return;
    }
    this.incomplete ||= listing.incomplete;
    rules = await this.loadRules(directory, rules);
    for (const entry of listing.entries.sort((a, b) => a.name.localeCompare(b.name))) {
      this.scanned++;
      if (!this.available()) return;
      if (
        sensitive(entry.name) ||
        (!this.input.includeHidden && entry.name.startsWith('.')) ||
        entry.type === 'symlink'
      )
        continue;
      const target = path.join(directory, entry.name);
      if (
        rules.some((rule) =>
          rule.matcher.ignores(
            path.relative(rule.root, target).split(path.sep).join('/') +
              (entry.type === 'directory' ? '/' : ''),
          ),
        )
      )
        continue;
      if (entry.type === 'directory') await this.visit(target, rules);
      else if (entry.type === 'file')
        this.files.push(path.relative(this.root, target).split(path.sep).join('/'));
    }
  }
  private async loadRules(directory: string, rules: Rules): Promise<Rules> {
    if (!this.input.respectIgnore) return rules;
    try {
      const file = await this.content.load(path.join(directory, '.gitignore'), false, this.signal);
      return [...rules, { root: directory, matcher: ignore().add(file.text) }];
    } catch (error) {
      this.signal.throwIfAborted();
      if (!(error instanceof PraxisError && error.code === 'FILE_NOT_FOUND'))
        this.incomplete = true;
      return rules;
    }
  }
}
