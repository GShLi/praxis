import type { ToolResult } from '@praxis/contracts';
import { WorkspaceFiles } from './files.ts';
import { schemas } from './schemas.ts';
export async function executeFilesTool(
  files: WorkspaceFiles,
  name: keyof typeof schemas,
  raw: unknown,
  signal: AbortSignal,
  result: ToolResult,
) {
  switch (name) {
    case 'fs_list':
      result.data = await files.list(schemas.fs_list.parse(raw));
      break;
    case 'fs_find':
      result.data = await files.find(schemas.fs_find.parse(raw), signal);
      break;
    case 'fs_search':
      result.data = await files.search(schemas.fs_search.parse(raw), signal);
      break;
    case 'fs_read':
      result.data = await files.read(schemas.fs_read.parse(raw));
      break;
    case 'fs_write':
      result.data = await files.write(schemas.fs_write.parse(raw), signal);
      result.effectState = 'committed';
      break;
    case 'fs_apply_patch':
      result.data = await files.patch(schemas.fs_apply_patch.parse(raw), signal);
      result.effectState = 'committed';
      break;
  }
}
