import { Select } from '../controls/Select.tsx';
import { Icon } from '../Navigation.tsx';
import { useState } from 'react';

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
  const [busy, setBusy] = useState(false);
  return (
    <div className="workspace-bar">
      <Icon name="folder" />
      <button
        className="text-button workspace-path"
        disabled={Boolean(selected) || busy}
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
        <Select
          aria-label="Agent 文件权限"
          disabled={busy || snapshot.session.archived}
          value={snapshot.session.permissionMode ?? 'workspace-write'}
          onChange={(value) => {
            setBusy(true);
            void client.setPermissions!(
              snapshot.session.id,
              snapshot.session.permissionRevision ?? 0,
              value as 'read-only' | 'workspace-write',
            )
              .catch(fail)
              .finally(() => setBusy(false));
          }}
        >
          <option value="workspace-write">工作区可写</option>
          <option value="read-only">只读</option>
        </Select>
      )}
      {busy && <span role="status">正在更新权限…</span>}
    </div>
  );
}
