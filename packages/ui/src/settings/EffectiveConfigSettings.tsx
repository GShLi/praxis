import type { PraxisClient } from '../client-types.ts';
import { CopyValue, Row, Status } from './controls.tsx';
import { useEffectiveConfig } from './useEffectiveConfig.ts';

export function EffectiveConfigSettings({
  client,
  sessionId,
  throughSeq,
}: {
  client: PraxisClient;
  sessionId: string;
  throughSeq: number;
}) {
  const { state, message } = useEffectiveConfig(client, sessionId, throughSeq);
  if (!client.effectiveConfig) return null;
  const snapshot = state?.snapshot;
  return (
    <section className="settings-section">
      <h2>工作区配置</h2>
      <div className="settings-group">
        <Row
          title="配置来源"
          description="从工作区 .praxis/config.json 读取忽略规则、回答偏好与验证建议；修改后在下一次任务生效。"
        >
          <span className="setting-value">
            {snapshot ? `版本 ${snapshot.revision}` : '尚无任务快照'}
          </span>
        </Row>
        {snapshot && (
          <Row
            title="搜索忽略规则"
            description="仅影响遵循忽略规则的搜索；文件访问仍由当前权限决定。"
          >
            <span className="setting-value">
              {snapshot.values.workspace?.ignore.length ?? 0} 条
            </span>
          </Row>
        )}
      </div>
      {state && (
        <details className="settings-diagnostics">
          <summary>查看最近任务的配置和当前权限</summary>
          <pre>{JSON.stringify(state, null, 2)}</pre>
          <CopyValue value={JSON.stringify(state, null, 2)} />
        </details>
      )}
      <Status message={message} />
    </section>
  );
}
