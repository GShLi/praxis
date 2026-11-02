import { Icon } from '../Navigation.tsx';

import type { AppController } from '../app/useAppController.ts';

export function WorkspaceBar({
  client,
  selected,
  snapshot,
  workspace,
  setWorkspace,
  fail,
}: Pick<
  AppController,
  'client' | 'selected' | 'snapshot' | 'workspace' | 'setWorkspace' | 'fail'
>) {
  return (
    <div className="workspace-bar">
      <Icon name="folder" />
      <button
        className="text-button workspace-path"
        disabled={Boolean(selected)}
        onClick={() => {
          void client
            .selectWorkspace?.()
            .then((value) => {
              if (value) setWorkspace(value);
            })
            .catch(fail);
        }}
      >
        {snapshot?.session.workspace ?? (workspace || '选择工作区')}
      </button>
      {snapshot && client.setPermissions && (
        <select
          aria-label="Agent 文件权限"
          value={snapshot.session.permissionMode ?? 'workspace-write'}
          onChange={(e) => {
            void client.setPermissions!(
              snapshot.session.id,
              snapshot.session.permissionRevision ?? 0,
              e.target.value as 'read-only' | 'workspace-write',
            ).catch(fail);
          }}
        >
          <option value="workspace-write">工作区可写</option>
          <option value="read-only">只读</option>
        </select>
      )}
    </div>
  );
}
