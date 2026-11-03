import { assert, PraxisError } from '@praxis/contracts';
import { hash, type SessionStore } from '@praxis/storage-local';
import type { WorkspaceFiles } from '@praxis/tools/files';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  instructionMessages,
  restoreInstructions,
  saveInstructionSnapshot,
  type InstructionSource,
} from './instruction-snapshot.ts';

/** A turn owns its instruction index. Durable snapshots retain the scopes discovered in prior turns. */
export class ProjectInstructions {
  private sources = new Map<string, InstructionSource>();
  private scopes = new Set<string>();
  private seenRevision = 0;
  private pending: Promise<void> = Promise.resolve();
  revision: number;
  constructor(
    private files: WorkspaceFiles,
    private store: SessionStore,
    private sessionId: string,
    private signal: AbortSignal,
  ) {
    const previous = restoreInstructions(store, sessionId);
    this.revision = previous.revision;
    this.scopes.add(files.root);
    for (const source of previous.sources) {
      this.sources.set(source.scope, source);
      this.scopes.add(source.scope);
    }
  }
  async prompt() {
    await this.reload([...this.scopes]);
    this.seenRevision = this.revision;
    return instructionMessages(this.ordered());
  }
  async beforeTool(name: string, parameters: Record<string, unknown>, writing: boolean) {
    if (!name.startsWith('fs_') && name !== 'process_exec') return;
    const input = String(
      name === 'process_exec' ? (parameters.cwd ?? '.') : (parameters.path ?? '.'),
    );
    const target = await this.files.resolve(input, writing);
    let canonical = target;
    try {
      canonical = await realpath(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const directory = ['fs_list', 'fs_find', 'fs_search', 'process_exec'].includes(name)
      ? canonical
      : path.dirname(canonical);
    await this.discoverDirectory(directory);
    assert(
      !writing || this.revision === this.seenRevision,
      'INSTRUCTIONS_CHANGED',
      '适用的项目指令已变化；本次写入未执行。请在下一步读取新指令后重新决定。',
    );
  }
  async discoverDirectory(directory: string) {
    const target = await this.files.resolve(directory);
    const components = path.relative(this.files.root, target).split(path.sep).filter(Boolean);
    const scopes = [this.files.root];
    for (const component of components) scopes.push(path.join(scopes.at(-1)!, component));
    await this.reload(scopes);
  }
  private ordered() {
    return [...this.sources.values()].sort(
      (a, b) =>
        a.scope.split(path.sep).length - b.scope.split(path.sep).length ||
        a.scope.localeCompare(b.scope),
    );
  }
  private reload(scopes: string[]) {
    const operation = this.pending.then(() => this.commitReload(scopes));
    this.pending = operation.then(
      () => {},
      () => {},
    ); // A rejected access must not poison later accesses.
    return operation;
  }
  private async commitReload(scopes: string[]) {
    const candidate = new Map(this.sources);
    for (const scope of scopes) {
      this.signal.throwIfAborted();
      const target = path.join(scope, 'AGENTS.md');
      try {
        const content = await this.files.readText(target, 64 * 1024);
        const digest = hash(content);
        const previous = candidate.get(scope);
        candidate.set(scope, {
          path: target,
          scope,
          hash: digest,
          content,
          contentObjectId: previous?.hash === digest ? previous.contentObjectId : '',
          sourceType: 'project',
          instructionRevision:
            previous?.hash === digest ? previous.instructionRevision : this.revision + 1,
        });
      } catch (error) {
        if (error instanceof PraxisError && error.code === 'FILE_NOT_FOUND')
          candidate.delete(scope);
        else throw error;
      }
    }
    assert(
      candidate.size <= 32 &&
        [...candidate.values()].reduce((n, s) => n + Buffer.byteLength(s.content), 0) <= 64 * 1024,
      'INSTRUCTIONS_LIMIT',
      '项目指令最多 32 个文件、累计 64 KiB；未截断规则。',
    );
    const changed =
      candidate.size !== this.sources.size ||
      [...candidate].some(([scope, source]) => this.sources.get(scope)?.hash !== source.hash);
    if (!changed) return;
    this.signal.throwIfAborted();
    const revision = this.revision + 1;
    saveInstructionSnapshot(this.store, this.sessionId, revision, [...candidate.values()]);
    this.sources = candidate;
    this.revision = revision;
    for (const source of candidate.values()) this.scopes.add(source.scope);
  }
}
