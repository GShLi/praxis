import { assert, PraxisError } from '@praxis/contracts';
import { hash } from '@praxis/storage-local';
import * as fs from 'node:fs/promises';
import { absent, WorkspacePathPolicy } from './policy.ts';
import type { Loaded, Observation } from './types.ts';
export const FILE_LIMIT = 2 * 1024 * 1024;
const DISPLAY_LIMIT = 12 * 1024;
export class FileContent {
  private observations = new Map<string, Observation>();
  constructor(private paths: WorkspacePathPolicy) {}
  async load(input: string, writing = false, signal?: AbortSignal): Promise<Loaded> {
    const target = await this.paths.resolve(input, writing);
    try {
      // Resolve allowed links, then open every component relative to the pinned native root.
      const real = await fs.realpath(target);
      await this.paths.resolve(real, writing);
      const after = await this.paths.io.read(real, signal);
      const buffer = after.buffer;
      assert(!buffer.includes(0), 'UNSUPPORTED_ENCODING', '不支持二进制文件。');
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
      } catch {
        throw new PraxisError('UNSUPPORTED_ENCODING', '文件不是有效 UTF-8。');
      }
      const identity = after.identity;
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
    }
  }
  async read(input: { path: string; startLine: number; lineCount: number }, signal?: AbortSignal) {
    const file = await this.load(input.path, false, signal);
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
  observed(file: Loaded, version: string, start = 0, end = file.text.length) {
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
  recordWritten(target: string, version: string, length: number) {
    this.observations.set(target, { version, ranges: [[0, length]], length });
  }
}
