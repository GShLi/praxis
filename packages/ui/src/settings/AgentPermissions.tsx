import { Select } from '../controls/Select.tsx';
import { useState } from 'react';
import type { PraxisClient, Snapshot } from '../client-types.ts';
import { errorText, Row, Status } from './controls.tsx';

export function AgentPermissions({
  client,
  snapshot,
}: {
  client: PraxisClient;
  snapshot: Snapshot | null;
}) {
  const [mode, setMode] = useState(
      localStorage.getItem('praxis-default-permission') ?? 'workspace-write',
    ),
    [message, setMessage] = useState('');
  return (
    <>
      <section className="settings-section">
        <h2>文件权限</h2>
        <div className="settings-group">
          <Row title="新任务的默认权限" description="只影响此客户端之后创建的 Agent 会话。">
            <Select
              aria-label="新任务默认权限"
              value={mode}
              onChange={(value) => {
                setMode(value);
                localStorage.setItem('praxis-default-permission', value);
              }}
            >
              <option value="workspace-write">工作区可写</option>
              <option value="read-only">只读</option>
            </Select>
          </Row>
          {snapshot?.session.kind === 'agent' && (
            <Row title="当前任务权限" description={snapshot.session.workspace}>
              <Select
                aria-label="当前任务权限"
                value={snapshot.session.permissionMode ?? 'workspace-write'}
                onChange={(value) => {
                  void client
                    .setPermissions?.(
                      snapshot.session.id,
                      snapshot.session.permissionRevision ?? 0,
                      value as 'read-only' | 'workspace-write',
                    )
                    .then(() => setMessage('当前任务权限已更新。'))
                    .catch((error) => setMessage(errorText(error)));
                }}
              >
                <option value="workspace-write">工作区可写</option>
                <option value="read-only">只读</option>
              </Select>
            </Row>
          )}
          <Row title="内部数据保护" description="应用凭据、会话存储和受保护目录不向文件工具开放。">
            <span className="settings-badge available">始终启用</span>
          </Row>
        </div>
      </section>
      <Status message={message} />
    </>
  );
}
