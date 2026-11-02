import { assert, PraxisError } from '@praxis/contracts';
import { uuid } from '@praxis/storage-local';
import ignore from 'ignore';
import { minimatch } from 'minimatch';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { FileContent } from './content.ts';
import { sensitive, WorkspacePathPolicy } from './policy.ts';
export class FileSearch {
  private snapshots = new Map<string, { key: string; entries: unknown[]; offset: number }>();
  constructor(
    private paths: WorkspacePathPolicy,
    private content: FileContent,
  ) {}
  async list(input: {
    path: string;
    includeHidden: boolean;
    limit: number;
    cursor?: string | undefined;
  }) {
    const target = await this.paths.resolve(input.path);
    const key = JSON.stringify({ path: target, hidden: input.includeHidden });
    if (input.cursor) {
      const snapshot = this.snapshots.get(input.cursor);
      assert(snapshot?.key === key, 'CURSOR_EXPIRED', '目录游标无效。');
      const entries = snapshot.entries.slice(snapshot.offset, snapshot.offset + input.limit);
      const offset = snapshot.offset + entries.length;
      let nextCursor: string | undefined;
      if (offset < snapshot.entries.length) {
        nextCursor = uuid();
        this.snapshots.set(nextCursor, { ...snapshot, offset });
      }
      return {
        path: target,
        entries,
        truncated: Boolean(nextCursor),
        ...(nextCursor ? { nextCursor } : {}),
      };
    }
    const entries = (await fs.readdir(target, { withFileTypes: true }))
      .filter((e) => !sensitive(e.name) && (input.includeHidden || !e.name.startsWith('.')))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 10_000)
      .map((entry) => ({
        name: entry.name,
        path: path.join(target, entry.name),
        type: entry.isSymbolicLink()
          ? 'symlink'
          : entry.isDirectory()
            ? 'directory'
            : entry.isFile()
              ? 'file'
              : 'other',
      }));
    let nextCursor: string | undefined;
    if (entries.length > input.limit) {
      nextCursor = uuid();
      this.snapshots.set(nextCursor, { key, entries, offset: input.limit });
    }
    if (this.snapshots.size > 32) this.snapshots.delete(this.snapshots.keys().next().value!);
    return {
      path: target,
      entries: entries.slice(0, input.limit),
      truncated: entries.length > input.limit,
      ...(nextCursor ? { nextCursor } : {}),
    };
  }
  async scan(
    input: { path: string; includeHidden: boolean; respectIgnore: boolean },
    signal: AbortSignal,
  ) {
    const root = await this.paths.resolve(input.path);
    const files: string[] = [];
    let incomplete = false;
    let scanned = 0;
    const deadline = Date.now() + 30_000;
    const walk = async (
      directory: string,
      rules: Array<{ root: string; matcher: ReturnType<typeof ignore> }>,
    ) => {
      signal.throwIfAborted();
      if (Date.now() > deadline || scanned > 20_000) {
        incomplete = true;
        return;
      }
      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        incomplete = true;
        return;
      }
      if (input.respectIgnore) {
        try {
          const file = await this.content.load(path.join(directory, '.gitignore'));
          rules = [...rules, { root: directory, matcher: ignore().add(file.text) }];
        } catch (error) {
          if (!(error instanceof PraxisError && error.code === 'FILE_NOT_FOUND')) incomplete = true;
        }
      }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        scanned++;
        if (scanned > 20_000 || Date.now() > deadline) {
          incomplete = true;
          return;
        }
        if (
          sensitive(entry.name) ||
          (!input.includeHidden && entry.name.startsWith('.')) ||
          entry.isSymbolicLink()
        )
          continue;
        const target = path.join(directory, entry.name);
        const relative = path.relative(root, target).split(path.sep).join('/');
        if (
          rules.some((rule) =>
            rule.matcher.ignores(
              path.relative(rule.root, target).split(path.sep).join('/') +
                (entry.isDirectory() ? '/' : ''),
            ),
          )
        )
          continue;
        if (entry.isDirectory()) await walk(target, rules);
        else if (entry.isFile()) files.push(relative);
      }
    };
    await walk(root, []);
    return { root, files, incomplete };
  }
  async find(
    input: {
      pattern: string;
      path: string;
      includeHidden: boolean;
      respectIgnore: boolean;
      limit: number;
    },
    signal: AbortSignal,
  ) {
    const scan = await this.scan(input, signal);
    const paths = scan.files.filter((file) =>
      minimatch(file, input.pattern, { dot: input.includeHidden }),
    );
    return {
      root: scan.root,
      paths: paths.slice(0, input.limit),
      incomplete: scan.incomplete,
      truncated: paths.length > input.limit,
    };
  }
  async search(
    input: {
      query: string;
      path: string;
      syntax: 'literal' | 'regex';
      include: string[];
      caseSensitive: boolean;
      includeHidden: boolean;
      respectIgnore: boolean;
      contextLines: number;
      limit: number;
    },
    signal: AbortSignal,
  ) {
    assert(
      input.syntax === 'literal',
      'SEARCH_SYNTAX_UNAVAILABLE',
      '当前内置搜索支持字面量；正则后端尚未通过平台验证。',
    );
    const scan = await this.scan(input, signal);
    const matches: unknown[] = [];
    let incomplete = scan.incomplete;
    let truncated = false;
    const query = input.caseSensitive ? input.query : input.query.toLocaleLowerCase();
    let bytes = 0;
    const deadline = Date.now() + 30_000;
    for (const relative of scan.files) {
      signal.throwIfAborted();
      if (Date.now() > deadline || bytes > 32 * 1024 * 1024) {
        incomplete = true;
        break;
      }
      if (
        input.include.length &&
        !input.include.some((glob) => minimatch(relative, glob, { dot: input.includeHidden }))
      )
        continue;
      let file;
      try {
        file = await this.content.load(path.join(scan.root, relative));
      } catch {
        incomplete = true;
        continue;
      }
      bytes += Buffer.byteLength(file.text);
      const lines = file.text.split(/\r\n|\n|\r/);
      for (const [index, line] of lines.entries()) {
        const offset = (input.caseSensitive ? line : line.toLocaleLowerCase()).indexOf(query);
        if (offset < 0) continue;
        if (matches.length >= input.limit) {
          truncated = true;
          break;
        }
        matches.push({
          path: relative,
          line: index + 1,
          column: [...line.slice(0, offset)].length + 1,
          text: line.slice(0, 1000),
          lineTruncated: line.length > 1000,
          contextBefore: lines
            .slice(Math.max(0, index - input.contextLines), index)
            .map((s) => s.slice(0, 1000)),
          contextAfter: lines
            .slice(index + 1, index + 1 + input.contextLines)
            .map((s) => s.slice(0, 1000)),
        });
      }
      if (truncated) break;
    }
    return { matches, truncated, incomplete };
  }
}
