import { assert } from '@praxis/contracts';
import { uuid } from '@praxis/storage-local';
import { minimatch } from 'minimatch';
import path from 'node:path';
import { FileContent } from './content.ts';
import { sensitive, WorkspacePathPolicy } from './policy.ts';
import { searchContent, type SearchInput } from './text-search.ts';
import { readDirectory } from './directory.ts';
import { scanFiles } from './traversal.ts';
import type { NativeDirectoryEntry } from './native/protocol.ts';
interface DirectorySnapshot {
  key: string;
  entries: Array<NativeDirectoryEntry & { path: string }>;
  offset: number;
  incomplete: boolean;
}
export class FileSearch {
  ignorePatterns: string[] = [];
  beforeDirectory: ((directory: string) => Promise<void>) | undefined;
  private snapshots = new Map<string, DirectorySnapshot>();
  constructor(
    private paths: WorkspacePathPolicy,
    private content: FileContent,
  ) {}
  async list(
    input: {
      path: string;
      includeHidden: boolean;
      limit: number;
      cursor?: string | undefined;
    },
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const target = await this.paths.resolve(input.path);
    signal?.throwIfAborted();
    const key = JSON.stringify({ path: target, hidden: input.includeHidden });
    if (input.cursor) {
      const snapshot = this.snapshots.get(input.cursor);
      assert(snapshot?.key === key, 'CURSOR_EXPIRED', '目录游标无效。');
      const entries = snapshot.entries.slice(snapshot.offset, snapshot.offset + input.limit);
      const offset = snapshot.offset + entries.length;
      let nextCursor: string | undefined;
      if (offset < snapshot.entries.length) nextCursor = this.remember({ ...snapshot, offset });
      return {
        path: target,
        entries,
        incomplete: snapshot.incomplete,
        truncated: Boolean(nextCursor),
        ...(nextCursor ? { nextCursor } : {}),
      };
    }
    const listing = await readDirectory(this.paths, target, signal);
    const entries = listing.entries
      .filter((e) => !sensitive(e.name) && (input.includeHidden || !e.name.startsWith('.')))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 10_000)
      .map((entry) => ({
        name: entry.name,
        path: path.join(target, entry.name),
        type: entry.type,
      }));
    let nextCursor: string | undefined;
    if (entries.length > input.limit) {
      nextCursor = this.remember({
        key,
        entries,
        offset: input.limit,
        incomplete: listing.incomplete,
      });
    }
    return {
      path: target,
      entries: entries.slice(0, input.limit),
      incomplete: listing.incomplete,
      truncated: entries.length > input.limit,
      ...(nextCursor ? { nextCursor } : {}),
    };
  }
  private remember(snapshot: DirectorySnapshot) {
    const cursor = uuid();
    this.snapshots.set(cursor, snapshot);
    if (this.snapshots.size > 32) {
      const oldest = this.snapshots.keys().next().value;
      if (oldest) this.snapshots.delete(oldest);
    }
    return cursor;
  }
  scan(
    input: { path: string; includeHidden: boolean; respectIgnore: boolean },
    signal: AbortSignal,
  ) {
    return scanFiles(
      this.paths,
      this.content,
      input,
      signal,
      this.beforeDirectory,
      this.ignorePatterns,
    );
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
  search(input: SearchInput, signal: AbortSignal) {
    return searchContent(input, signal, this.content, () => this.scan(input, signal));
  }
}
