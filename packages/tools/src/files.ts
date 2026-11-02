import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { minimatch } from 'minimatch';
import ignore from 'ignore';
import { assert, PraxisError } from '../../contracts/src/index.ts';
import { hash, uuid } from '../../storage-local/src/index.ts';

const FILE_LIMIT = 2 * 1024 * 1024;
const DISPLAY_LIMIT = 12 * 1024;
const protectedParts = new Set(['.git', '.hg', '.svn', '.ssh', '.aws', '.gnupg', '.praxis']);
function sensitive(name: string) {
  return (
    protectedParts.has(name.toLowerCase()) ||
    /^\.env(?:\.|$)/i.test(name) ||
    /\.(?:pem|key|p12|pfx)$/i.test(name)
  );
}
export function isInside(root: string, target: string) {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}
function absent(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}
interface Observation {
  version: string;
  ranges: Array<[number, number]>;
  length: number;
}
interface Loaded {
  target: string;
  text: string;
  version: string;
  mode: number;
  nlink: number;
  identity: string;
}

/** File access is scoped by the Host. It is separate from OS command isolation. */
export class WorkspaceFiles {
  private observations = new Map<string, Observation>();
  private snapshots = new Map<string, { key: string; entries: unknown[]; offset: number }>();
  private constructor(
    readonly root: string,
    private artifact: (kind: string, text: string) => string,
    private protectedPaths: string[],
    private beforeWrite: () => void,
  ) {}
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
  async resolve(input: string, writing = false): Promise<string> {
    assert(!input.includes('\0'), 'INVALID_ARGUMENT', '路径包含非法字符。');
    const target = path.resolve(this.root, input);
    assert(isInside(this.root, target), 'ACCESS_DENIED', '目标不在工作区内。');
    assert(
      !this.protectedPaths.some((p) => isInside(p, target)),
      'ACCESS_DENIED',
      '目标属于受保护的应用数据。',
    );
    const components = path.relative(this.root, target).split(path.sep).filter(Boolean);
    assert(
      !components.some(
        (part) =>
          /[:\x00-\x1f]/.test(part) ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      ),
      'ACCESS_DENIED',
      '不支持设备路径、数据流或不明确的文件别名。',
    );
    assert(!components.some(sensitive), 'ACCESS_DENIED', '该路径属于敏感或内部数据。');
    let current = this.root;
    for (const component of components) {
      current = path.join(current, component);
      try {
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink()) {
          assert(!writing, 'ACCESS_DENIED', '专用写工具不修改符号链接路径。');
          const real = await fs.realpath(current);
          assert(
            isInside(this.root, real) &&
              !this.protectedPaths.some((p) => isInside(p, real)) &&
              !path.relative(this.root, real).split(path.sep).some(sensitive),
            'ACCESS_DENIED',
            '链接目标超出读取范围。',
          );
        }
      } catch (error) {
        if (!absent(error)) throw error;
        break;
      }
    }
    return target;
  }
  private async load(input: string, writing = false): Promise<Loaded> {
    const target = await this.resolve(input, writing);
    let handle;
    try {
      // Resolve authorized links, then open with NOFOLLOW to detect a switched final link.
      const real = await fs.realpath(target);
      await this.resolve(real, writing);
      handle = await fs.open(real, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const before = await handle.stat();
      assert(before.nlink === 1, 'ACCESS_DENIED', '拒绝读取来源不明确的多硬链接文件。');
      assert(before.isFile(), 'UNSUPPORTED_FILE', '只支持普通文本文件。');
      assert(before.size <= FILE_LIMIT, 'FILE_TOO_LARGE', '文件超过 2 MiB。');
      const buffer = await handle.readFile();
      const after = await handle.stat();
      assert(buffer.length <= FILE_LIMIT, 'FILE_TOO_LARGE', '文件超过 2 MiB。');
      assert(
        before.mtimeMs === after.mtimeMs &&
          before.ctimeMs === after.ctimeMs &&
          before.size === after.size,
        'FILE_CHANGED_DURING_READ',
        '读取期间文件发生变化。',
      );
      assert(!buffer.includes(0), 'UNSUPPORTED_ENCODING', '不支持二进制文件。');
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
      } catch {
        throw new PraxisError('UNSUPPORTED_ENCODING', '文件不是有效 UTF-8。');
      }
      const identity = `${after.dev}:${after.ino}`;
      return {
        target,
        text,
        version: hash(identity + ':' + hash(buffer)),
        mode: after.mode & 0o777,
        nlink: after.nlink,
        identity,
      };
    } catch (error) {
      if (absent(error)) throw new PraxisError('FILE_NOT_FOUND', '文件不存在。');
      throw error;
    } finally {
      await handle?.close();
    }
  }
  async read(input: { path: string; startLine: number; lineCount: number }) {
    const file = await this.load(input.path);
    const matches = Array.from(file.text.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)).filter(
      (m) => m[0] !== '',
    );
    const lines: Array<{ number: number; text: string; ending: string }> = [];
    const previous = this.observations.get(file.target);
    const observation: Observation =
      previous?.version === file.version
        ? previous
        : { version: file.version, ranges: [], length: file.text.length };
    let bytes = 0;
    let truncated = false;
    for (
      let index = input.startLine - 1;
      index < Math.min(matches.length, input.startLine - 1 + input.lineCount);
      index++
    ) {
      const match = matches[index]!;
      const raw = match[0];
      const ending = raw.match(/(\r\n|\n|\r)$/)?.[0] ?? '';
      const content = raw.slice(0, raw.length - ending.length);
      const entry = { number: index + 1, text: content, ending };
      const encodedBytes = Buffer.byteLength(JSON.stringify(entry)) + 1;
      if (bytes + encodedBytes > DISPLAY_LIMIT) {
        truncated = true;
        break;
      }
      lines.push(entry);
      bytes += encodedBytes;
      observation.ranges.push([match.index, match.index + raw.length]);
    }
    if (!file.text.length) observation.ranges.push([0, 0]);
    this.observations.set(file.target, observation);
    const next = input.startLine + lines.length;
    const eof = !truncated && next > matches.length;
    return {
      path: file.target,
      fileVersion: file.version,
      lines,
      eof,
      ...(!eof ? { nextStartLine: next } : {}),
      truncated,
      encoding: 'utf-8',
      newline: file.text.includes('\r\n') ? 'CRLF or mixed' : 'LF',
    };
  }
  private observed(file: Loaded, version: string, start = 0, end = file.text.length) {
    const observation = this.observations.get(file.target);
    assert(observation, 'FILE_NOT_OBSERVED', '请先通过 fs_read 读取要修改的内容。');
    assert(
      observation.version === version && file.version === version,
      'FILE_VERSION_CONFLICT',
      '文件已变化，请重新读取。',
    );
    let cursor = start;
    for (const range of [...observation.ranges].sort((a, b) => a[0] - b[0]))
      if (range[0] <= cursor) cursor = Math.max(cursor, range[1]);
    assert(cursor >= end, 'FILE_NOT_OBSERVED', '修改范围包含未完整读取的内容。');
    assert(file.nlink === 1, 'ACCESS_DENIED', '专用写工具不修改多硬链接文件。');
  }
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
      await this.resolve(target, true);
      if (before) {
        const latest = await this.load(target, true);
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
    const after = await this.load(target, true);
    assert(after.text === content, 'FILE_PUBLISH_UNKNOWN', '发布后内容发生变化，请检查文件状态。');
    this.observations.set(target, {
      version: after.version,
      ranges: [[0, content.length]],
      length: content.length,
    });
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
    const target = await this.resolve(input.path, true);
    const createdDirectories: string[] = [];
    let before: Loaded | undefined;
    if (input.mode === 'replace') {
      before = await this.load(input.path, true);
      this.observed(before, input.expectedVersion!);
    } else if (input.createParents) {
      let current = this.root;
      for (const component of path
        .relative(this.root, path.dirname(target))
        .split(path.sep)
        .filter(Boolean)) {
        current = path.join(current, component);
        signal.throwIfAborted();
        await this.resolve(current, true);
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
    const before = await this.load(input.path, true);
    const replacements: Array<{ start: number; end: number; text: string }> = [];
    for (const edit of input.edits) {
      assert(edit.oldText !== edit.newText, 'INVALID_ARGUMENT', '补丁必须实际修改内容。');
      let cursor = 0;
      let count = 0;
      while ((cursor = before.text.indexOf(edit.oldText, cursor)) !== -1) {
        this.observed(before, input.expectedVersion, cursor, cursor + edit.oldText.length);
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
  async list(input: {
    path: string;
    includeHidden: boolean;
    limit: number;
    cursor?: string | undefined;
  }) {
    const target = await this.resolve(input.path);
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
    const root = await this.resolve(input.path);
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
          const file = await this.load(path.join(directory, '.gitignore'));
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
        file = await this.load(path.join(scan.root, relative));
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
