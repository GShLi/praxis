import { record } from './tool-presentation.ts';

/** The existing file-change artifact is an immutable observation, never the live workspace. */
export interface FileChange {
  path: string;
  before: string | null;
  after: string;
}

export function parseFileChangeArtifact(artifact: { kind: string; content: string }): FileChange {
  if (artifact.kind !== 'file-change') throw new Error('此产物不是文件变更记录。');
  let parsed: unknown;
  try {
    parsed = JSON.parse(artifact.content);
  } catch {
    throw new Error('文件变更记录无法解析，请重试。');
  }
  const value = record(parsed);
  if (
    !value ||
    typeof value.path !== 'string' ||
    typeof value.after !== 'string' ||
    (value.before !== null && typeof value.before !== 'string')
  )
    throw new Error('文件变更记录不完整，无法展示历史快照。');
  return { path: value.path, before: value.before, after: value.after };
}
