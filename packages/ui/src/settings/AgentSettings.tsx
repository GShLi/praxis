import { AgentPermissions } from './AgentPermissions.tsx';
import type { PraxisClient, Snapshot } from '../client-types.ts';
import { Row, SettingsIcon } from './controls.tsx';
import { EffectiveConfigSettings } from './EffectiveConfigSettings.tsx';

export function AgentSettings({
  client,
  snapshot,
}: {
  client: PraxisClient;
  snapshot: Snapshot | null;
}) {
  return (
    <>
      <AgentPermissions client={client} snapshot={snapshot} />
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
      {snapshot?.session.kind === 'agent' && (
        <EffectiveConfigSettings
          client={client}
          sessionId={snapshot.session.id}
          throughSeq={snapshot.throughSeq}
        />
      )}
      <div className="settings-info-note">
        <SettingsIcon name="terminal" />
        <p>命令执行需通过对应系统的沙箱检查。当前版本尚未开放命令后端，文件工具可以独立使用。</p>
      </div>
    </>
  );
}
