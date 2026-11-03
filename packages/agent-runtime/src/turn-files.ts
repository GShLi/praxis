import { parseWorkspaceConfig } from '@praxis/config';
import { assert, type ModelConfig, type Session } from '@praxis/contracts';
import type { SessionStore } from '@praxis/storage-local';
import { WorkspaceFiles } from '@praxis/tools/files';
import { ProjectInstructions } from './instructions.ts';
import type { Active, RuntimeOptions } from './types.ts';

/** The turn pins project preferences; file permission remains a live control-plane decision. */
export async function createTurnFiles(
  store: SessionStore,
  options: RuntimeOptions,
  session: Session,
  turn: Active,
  workspace: string,
  config?: ModelConfig,
) {
  const files = await WorkspaceFiles.open(
    workspace,
    (kind, text) => store.artifact(session.id, kind, text),
    options.protectedPaths,
    () =>
      assert(
        store.get(session.id).permission.mode === 'workspace-write',
        'ACCESS_DENIED',
        '当前权限禁止写入。',
      ),
  );
  turn.workspaceConfig = parseWorkspaceConfig(
    await files.readConfiguration(turn.controller.signal),
    config ? [config.apiKey] : [],
  );
  files.setSearchIgnores(turn.workspaceConfig.value.ignore);
  if (!turn.command) {
    const instructions = new ProjectInstructions(files, store, session.id, turn.controller.signal);
    turn.instructions = instructions;
    files.observeSearchDirectories((directory) => instructions.discoverDirectory(directory));
  }
  return files;
}
