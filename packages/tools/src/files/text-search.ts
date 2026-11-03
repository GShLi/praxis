import { minimatch } from 'minimatch';
import path from 'node:path';
import type { FileContent } from './content.ts';
import { SearchMatcher } from './search-matcher.ts';
export interface SearchInput {
  query: string;
  path: string;
  syntax: 'literal' | 'regex';
  include: string[];
  caseSensitive: boolean;
  includeHidden: boolean;
  respectIgnore: boolean;
  contextLines: number;
  limit: number;
}
function projectMatch(
  relative: string,
  lines: string[],
  index: number,
  offset: number,
  context: number,
) {
  const line = lines[index]!;
  return {
    path: relative,
    line: index + 1,
    column: [...line.slice(0, offset)].length + 1,
    text: line.slice(0, 1000),
    lineTruncated: line.length > 1000,
    contextBefore: lines.slice(Math.max(0, index - context), index).map((s) => s.slice(0, 1000)),
    contextAfter: lines.slice(index + 1, index + 1 + context).map((s) => s.slice(0, 1000)),
  };
}
export async function searchContent(
  input: SearchInput,
  signal: AbortSignal,
  content: FileContent,
  scan: () => Promise<{ root: string; files: string[]; incomplete: boolean }>,
) {
  signal.throwIfAborted();
  const matcher = new SearchMatcher(input);
  try {
    // Validate syntax even when the workspace contains no readable files.
    await matcher.match('', 1, signal);
    const source = await scan();
    const matches: ReturnType<typeof projectMatch>[] = [];
    let incomplete = source.incomplete,
      truncated = false,
      bytes = 0;
    const deadline = Date.now() + 30_000;
    for (const relative of source.files) {
      signal.throwIfAborted();
      if (Date.now() > deadline || bytes >= 32 * 1024 * 1024) {
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
        file = await content.load(path.join(source.root, relative), false, signal);
      } catch {
        signal.throwIfAborted();
        incomplete = true;
        continue;
      }
      bytes += Buffer.byteLength(file.text);
      if (bytes > 32 * 1024 * 1024) {
        incomplete = true;
        break;
      }
      const found = await matcher.match(file.text, input.limit - matches.length + 1, signal);
      const lines = file.text.split(/\r\n|\n|\r/);
      for (const { line, offset } of found) {
        if (matches.length >= input.limit) {
          truncated = true;
          break;
        }
        matches.push(projectMatch(relative, lines, line, offset, input.contextLines));
      }
      if (truncated) break;
    }
    return { matches, truncated, incomplete };
  } finally {
    await matcher.close();
  }
}
