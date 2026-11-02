import { assert } from '@praxis/contracts';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { FileContent } from './files/content.ts';
import { isInside, WorkspacePathPolicy } from './files/policy.ts';
import { FileSearch } from './files/search.ts';
import { FileWriter } from './files/writer.ts';
export { isInside } from './files/policy.ts';
/** One workspace owns observations, pagination and the permission callback used at publication. */
export class WorkspaceFiles {
  private paths: WorkspacePathPolicy;
  private content: FileContent;
  private writer: FileWriter;
  private searcher: FileSearch;
  private constructor(
    readonly root: string,
    artifact: (kind: string, text: string) => string,
    protectedPaths: string[],
    beforeWrite: () => void,
  ) {
    this.paths = new WorkspacePathPolicy(root, protectedPaths);
    this.content = new FileContent(this.paths);
    this.writer = new FileWriter(this.paths, this.content, artifact, beforeWrite);
    this.searcher = new FileSearch(this.paths, this.content);
  }
  static async open(
    root: string,
    artifact: (kind: string, text: string) => string,
    protectedPaths: string[] = [],
    beforeWrite: () => void = () => {},
  ) {
    const canonical = await fs.realpath(root);
    const stat = await fs.stat(canonical);
    assert(stat.isDirectory(), 'INVALID_WORKSPACE', '工作区必须是目录。');
    const protectedRoots = await Promise.all(
      protectedPaths.map(async (p) => {
        try {
          return await fs.realpath(p);
        } catch {
          return path.resolve(p);
        }
      }),
    );
    assert(
      !protectedRoots.some((p) => isInside(p, canonical)),
      'ACCESS_DENIED',
      '不能使用 Praxis 内部目录作为工作区。',
    );
    return new WorkspaceFiles(canonical, artifact, protectedRoots, beforeWrite);
  }
  resolve(...args: Parameters<WorkspacePathPolicy['resolve']>) {
    return this.paths.resolve(...args);
  }
  read(...args: Parameters<FileContent['read']>) {
    return this.content.read(...args);
  }
  write(...args: Parameters<FileWriter['write']>) {
    return this.writer.write(...args);
  }
  patch(...args: Parameters<FileWriter['patch']>) {
    return this.writer.patch(...args);
  }
  list(...args: Parameters<FileSearch['list']>) {
    return this.searcher.list(...args);
  }
  scan(...args: Parameters<FileSearch['scan']>) {
    return this.searcher.scan(...args);
  }
  find(...args: Parameters<FileSearch['find']>) {
    return this.searcher.find(...args);
  }
  search(...args: Parameters<FileSearch['search']>) {
    return this.searcher.search(...args);
  }
}
