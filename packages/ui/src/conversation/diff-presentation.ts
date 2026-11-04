import { diffLimits, type DiffLine, type LineDiff } from './line-diff.ts';

export type DiffRow = DiffLine | { kind: 'gap'; count: number };

/** Fold unchanged runs, then bound DOM rows independently from the comparison budget. */
export function diffRows(diff: LineDiff) {
  const rows: DiffRow[] = [];
  let index = 0;
  while (index < diff.lines.length) {
    const line = diff.lines[index];
    if (!line) break;
    if (line.kind !== 'context') {
      rows.push(line);
      index++;
      continue;
    }
    let end = index;
    while (diff.lines[end]?.kind === 'context') end++;
    const count = end - index;
    if (count <= 6) rows.push(...diff.lines.slice(index, end));
    else {
      rows.push(...diff.lines.slice(index, index + 3));
      rows.push({ kind: 'gap', count: count - 6 });
      rows.push(...diff.lines.slice(end - 3, end));
    }
    index = end;
  }
  return {
    rows: rows.slice(0, diffLimits.displayRows),
    omittedRows: Math.max(0, rows.length - diffLimits.displayRows),
  };
}

export function diffLineText(raw: string) {
  const ending = raw.endsWith('\r\n') ? 'CRLF' : raw.endsWith('\n') ? 'LF' : 'none';
  const content = ending === 'CRLF' ? raw.slice(0, -2) : ending === 'LF' ? raw.slice(0, -1) : raw;
  return {
    text: content.slice(0, diffLimits.lineCharacters),
    truncated: content.length > diffLimits.lineCharacters,
    ending,
  };
}
