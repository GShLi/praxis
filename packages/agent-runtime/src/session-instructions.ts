import { assert, PraxisError } from '@praxis/contracts';
import { hash } from '@praxis/storage-local';
import { WorkspaceFiles } from '@praxis/tools/files';
import path from 'node:path';
import type { InstructionSource } from './instruction-snapshot.ts';

/** Resolve and validate before publishing a new Session, so failure cannot leave an orphan. */
export async function prepareSessionInstructions(
  workspace: string | undefined,
  protectedPaths: string[] = [],
) {
  assert(workspace, 'WORKSPACE_REQUIRED', 'Agent 会话需要工作区。');
  const files = await WorkspaceFiles.open(
    workspace,
    () => {
      throw new Error('read-only preparation');
    },
    protectedPaths,
  );
  let source: InstructionSource | undefined;
  try {
    const target = path.join(files.root, 'AGENTS.md');
    const content = await files.readText(target, 64 * 1024);
    source = {
      path: target,
      scope: files.root,
      hash: hash(content),
      content,
      contentObjectId: '',
      sourceType: 'project',
      instructionRevision: 1,
    };
  } catch (error) {
    if (!(error instanceof PraxisError && error.code === 'FILE_NOT_FOUND')) throw error;
  }
  return { root: files.root, source };
}
