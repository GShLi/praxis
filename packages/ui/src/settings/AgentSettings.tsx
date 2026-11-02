import { useState } from 'react';
import type { PraxisClient, Snapshot } from '../client.ts';
import { errorText, Row, SettingsIcon, Status } from './controls.tsx';

export function AgentSettings({
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
            <select
              aria-label="新任务默认权限"
              value={mode}
              onChange={(e) => {
                setMode(e.target.value);
                localStorage.setItem('praxis-default-permission', e.target.value);
              }}
            >
              <option value="workspace-write">工作区可写</option>
              <option value="read-only">只读</option>
            </select>
          </Row>
          {snapshot?.session.kind === 'agent' && (
            <Row title="当前任务权限" description={snapshot.session.workspace}>
              <select
                aria-label="当前任务权限"
                value={snapshot.session.permissionMode ?? 'workspace-write'}
                onChange={(e) => {
                  void client
                    .setPermissions?.(
                      snapshot.session.id,
                      snapshot.session.permissionRevision ?? 0,
                      e.target.value as 'read-only' | 'workspace-write',
                    )
                    .then(() => setMessage('当前任务权限已更新。'))
                    .catch((error) => setMessage(errorText(error)));
                }}
              >
                <option value="workspace-write">工作区可写</option>
                <option value="read-only">只读</option>
              </select>
            </Row>
          )}
          <Row title="内部数据保护" description="应用凭据、会话存储和受保护目录不向文件工具开放。">
            <span className="settings-badge available">始终启用</span>
          </Row>
        </div>
      </section>
      <section className="settings-section">
        <h2>任务生命周期</h2>
        <div className="settings-group">
          <Row title="关闭应用时" description="停止当前客户端的任务，保留已经保存的历史记录。">
            <span className="setting-value">停止执行</span>
          </Row>
          <Row title="再次打开时" description="由你发送新的要求后继续，历史工具调用不会自动重跑。">
            <span className="setting-value">手动继续</span>
          </Row>
        </div>
      </section>
      <Status message={message} />
      <div className="settings-info-note">
        <SettingsIcon name="terminal" />
        <p>命令执行需通过对应系统的沙箱检查。当前版本尚未开放命令后端，文件工具可以独立使用。</p>
      </div>
    </>
  );
}
