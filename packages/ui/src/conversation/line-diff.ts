export interface DiffLine {
  kind: 'context' | 'add' | 'remove';
  beforeLine: number | null;
  afterLine: number | null;
  raw: string;
}
export interface LineDiff {
  lines: DiffLine[];
  additions: number;
  deletions: number;
  complete: boolean;
  coarse: boolean;
}
export const diffLimits = {
  characters: 1_048_576,
  lines: 12_000,
  cells: 1_000_000,
  displayRows: 800,
  lineCharacters: 2000,
} as const;

/** Retain line endings: a final newline and CRLF changes are real edits, not blank lines. */
function readLines(text: string) {
  const bounded = text.slice(0, diffLimits.characters);
  const lines: string[] = [];
  let offset = 0;
  while (offset < bounded.length && lines.length < diffLimits.lines) {
    const newline = bounded.indexOf('\n', offset);
    const end = newline < 0 ? bounded.length : newline + 1;
    lines.push(bounded.slice(offset, end));
    offset = end;
  }
  return { lines, complete: offset === text.length };
}

/** Exact LCS in the changed region, with a fixed cell budget before allocating its matrix. */
function changedLines(before: string[], after: string[]) {
  const width = after.length + 1;
  const cells = (before.length + 1) * width;
  if (cells > diffLimits.cells)
    return {
      edits: [
        ...before.map((raw) => ({ kind: 'remove' as const, raw })),
        ...after.map((raw) => ({ kind: 'add' as const, raw })),
      ],
      coarse: true,
    };
  const table = new Uint32Array(cells);
  // The loops and matrix dimensions bound every array index below.
  for (let a = before.length - 1; a >= 0; a--) {
    for (let b = after.length - 1; b >= 0; b--) {
      table[a * width + b] =
        before[a] === after[b]
          ? 1 + table[(a + 1) * width + b + 1]!
          : Math.max(table[(a + 1) * width + b]!, table[a * width + b + 1]!);
    }
  }
  const edits: Array<Pick<DiffLine, 'kind' | 'raw'>> = [];
  let a = 0,
    b = 0;
  while (a < before.length || b < after.length) {
    if (a < before.length && b < after.length && before[a] === after[b]) {
      edits.push({ kind: 'context', raw: before[a++]! });
      b++;
    } else if (
      a < before.length &&
      (b === after.length || table[(a + 1) * width + b]! >= table[a * width + b + 1]!)
    ) {
      edits.push({ kind: 'remove', raw: before[a++]! });
    } else {
      edits.push({ kind: 'add', raw: after[b++]! });
    }
  }
  return { edits, coarse: false };
}

export function lineDiff(beforeText: string | null, afterText: string): LineDiff {
  const before = readLines(beforeText ?? '');
  const after = readLines(afterText);
  let prefix = 0,
    suffix = 0;
  const commonLength = Math.min(before.lines.length, after.lines.length);
  while (prefix < commonLength && before.lines[prefix] === after.lines[prefix]) prefix++;
  while (
    suffix < commonLength - prefix &&
    before.lines.at(-1 - suffix) === after.lines.at(-1 - suffix)
  )
    suffix++;
  const middle = changedLines(
    before.lines.slice(prefix, before.lines.length - suffix),
    after.lines.slice(prefix, after.lines.length - suffix),
  );
  const context = (raw: string) => ({ kind: 'context' as const, raw });
  const edits = [
    ...before.lines.slice(0, prefix).map(context),
    ...middle.edits,
    ...before.lines.slice(before.lines.length - suffix).map(context),
  ];
  let oldLine = 0,
    newLine = 0,
    additions = 0,
    deletions = 0;
  const lines = edits.map((edit) => {
    if (edit.kind === 'add') additions++;
    if (edit.kind === 'remove') deletions++;
    return {
      ...edit,
      beforeLine: edit.kind === 'add' ? null : ++oldLine,
      afterLine: edit.kind === 'remove' ? null : ++newLine,
    };
  });
  return {
    lines,
    additions,
    deletions,
    complete: before.complete && after.complete,
    coarse: middle.coarse,
  };
}
