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
    rootIdentity: string,
  ) {
    this.paths = new WorkspacePathPolicy(root, protectedPaths, rootIdentity);
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
    const stat = await fs.stat(canonical, { bigint: true });
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
    return new WorkspaceFiles(
      canonical,
      artifact,
      protectedRoots,
      beforeWrite,
      `${stat.dev}:${stat.ino}`,
    );
  }
  async readText(input: string, maxBytes: number): Promise<string> {
    const file = await this.content.load(input);
    assert(
      Buffer.byteLength(file.text) <= maxBytes,
      'INSTRUCTIONS_LIMIT',
      '项目指令超过读取限制。',
    );
    return file.text;
  }
  observeSearchDirectories(observer: (directory: string) => Promise<void>) {
    this.searcher.beforeDirectory = observer;
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
