import { assert, PraxisError } from '@praxis/contracts';
import { uuid } from '@praxis/storage-local';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { FILE_LIMIT, FileContent } from './content.ts';
import { WorkspacePathPolicy } from './policy.ts';
import type { Loaded } from './types.ts';
export class FileWriter {
  constructor(
    private paths: WorkspacePathPolicy,
    private content: FileContent,
    private artifact: (kind: string, text: string) => string,
    private beforeWrite: () => void,
  ) {}
  private async publish(
    target: string,
    content: string,
    before: Loaded | undefined,
    signal: AbortSignal,
  ) {
    this.beforeWrite();
    const diffArtifactId = this.artifact(
      'file-change',
      JSON.stringify({ path: target, before: before?.text ?? null, after: content }),
    );
    const temporary = path.join(path.dirname(target), `.praxis-${uuid()}.tmp`);
    await fs.writeFile(temporary, content, { flag: 'wx', mode: before?.mode ?? 0o644 });
    try {
      signal.throwIfAborted();
      await this.paths.resolve(target, true);
      if (before) {
        const latest = await this.content.load(target, true);
        assert(
          latest.version === before.version && latest.identity === before.identity,
          'FILE_VERSION_CONFLICT',
          '发布前文件发生变化。',
        );
        signal.throwIfAborted();
        this.beforeWrite();
        await fs.rename(temporary, target);
      } else {
        // Linking an already complete temporary file is atomic and fails if the destination exists.
        try {
          signal.throwIfAborted();
          this.beforeWrite();
          await fs.link(temporary, target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST')
            throw new PraxisError('FILE_ALREADY_EXISTS', '文件已存在，不能覆盖创建。');
          throw error;
        }
      }
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
    const after = await this.content.load(target, true);
    assert(after.text === content, 'FILE_PUBLISH_UNKNOWN', '发布后内容发生变化，请检查文件状态。');
    this.content.recordWritten(target, after.version, content.length);
    return {
      path: target,
      afterVersion: after.version,
      bytesWritten: Buffer.byteLength(content),
      diffArtifactId,
    };
  }
  async write(
    input: {
      path: string;
      mode: 'create' | 'replace';
      content: string;
      expectedVersion?: string;
      createParents?: boolean;
    },
    signal: AbortSignal,
  ) {
    assert(
      Buffer.byteLength(input.content) <= 1024 * 1024,
      'FILE_TOO_LARGE',
      '单次写入超过 1 MiB。',
    );
    const target = await this.paths.resolve(input.path, true);
    const createdDirectories: string[] = [];
    let before: Loaded | undefined;
    if (input.mode === 'replace') {
      before = await this.content.load(input.path, true);
      this.content.observed(before, input.expectedVersion!);
    } else if (input.createParents) {
      let current = this.paths.root;
      for (const component of path
        .relative(this.paths.root, path.dirname(target))
        .split(path.sep)
        .filter(Boolean)) {
        current = path.join(current, component);
        signal.throwIfAborted();
        await this.paths.resolve(current, true);
        try {
          await fs.mkdir(current);
          createdDirectories.push(current);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          assert((await fs.lstat(current)).isDirectory(), 'ACCESS_DENIED', '父路径不是普通目录。');
        }
      }
    }
    return {
      ...(await this.publish(target, input.content, before, signal)),
      operation: input.mode === 'create' ? 'created' : 'replaced',
      ...(before ? { beforeVersion: before.version } : {}),
      createdDirectories,
    };
  }
  async patch(
    input: {
      path: string;
      expectedVersion: string;
      edits: Array<{ oldText: string; newText: string; expectedMatches: number }>;
    },
    signal: AbortSignal,
  ) {
    const before = await this.content.load(input.path, true);
    const replacements: Array<{ start: number; end: number; text: string }> = [];
    for (const edit of input.edits) {
      assert(edit.oldText !== edit.newText, 'INVALID_ARGUMENT', '补丁必须实际修改内容。');
      let cursor = 0;
      let count = 0;
      while ((cursor = before.text.indexOf(edit.oldText, cursor)) !== -1) {
        this.content.observed(before, input.expectedVersion, cursor, cursor + edit.oldText.length);
        replacements.push({ start: cursor, end: cursor + edit.oldText.length, text: edit.newText });
        count++;
        cursor += edit.oldText.length;
      }
      assert(
        count === edit.expectedMatches,
        'PATCH_MATCH_COUNT_MISMATCH',
        '补丁匹配数量不符，文件保持不变。',
      );
    }
    replacements.sort((a, b) => a.start - b.start);
    for (let i = 1; i < replacements.length; i++)
      assert(
        replacements[i]!.start >= replacements[i - 1]!.end,
        'PATCH_OVERLAP',
        '补丁匹配范围重叠。',
      );
    let content = before.text;
    for (const edit of [...replacements].reverse())
      content = content.slice(0, edit.start) + edit.text + content.slice(edit.end);
    assert(Buffer.byteLength(content) <= FILE_LIMIT, 'FILE_TOO_LARGE', '补丁结果超过 2 MiB。');
    return {
      ...(await this.publish(before.target, content, before, signal)),
      beforeVersion: before.version,
      replacements: replacements.length,
    };
  }
}
