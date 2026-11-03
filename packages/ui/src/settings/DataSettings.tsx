import { useState } from 'react';
import type { PraxisClient, Snapshot } from '../client-types.ts';
import { errorText, Row, Status } from './controls.tsx';

export function DataSettings({
  client,
  snapshot,
}: {
  client: PraxisClient;
  snapshot: Snapshot | null;
}) {
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  async function exportCurrent() {
    if (!snapshot) return;
    setBusy(true);
    try {
      const data = await client.read(snapshot.session.id);
      const blob = new Blob(
        [
          JSON.stringify(
            {
              format: 'praxis-visible-conversation-v1',
              exportedAt: new Date().toISOString(),
              ...data,
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      );
      const url = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = url;
      a.download = `praxis-${snapshot.session.id}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setMessage('当前可见会话已导出。');
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="settings-section">
        <h2>会话数据</h2>
        <div className="settings-group">
          <Row
            title="历史记录保存位置"
            description={
              client.desktop
                ? '此桌面客户端的会话保存在本机，和 CLI 的会话分别管理。'
                : 'Web 对话保存在你的 Praxis 服务端，按登录账号隔离。'
            }
          >
            <span className="setting-value">{client.desktop ? '本机' : 'Praxis 服务端'}</span>
          </Row>
          <Row
            title="当前会话导出"
            description={
              snapshot
                ? `导出“${snapshot.session.title}”的可见消息与状态，格式为 JSON。`
                : '打开一个会话后，可以导出其中的可见消息与状态。'
            }
          >
            <button
              className="secondary-button"
              disabled={!snapshot || busy}
              onClick={() => {
                void exportCurrent();
              }}
            >
              {busy ? '正在导出…' : '导出会话'}
            </button>
          </Row>
        </div>
      </section>
      <section className="settings-section">
        <h2>模型与隐私</h2>
        <div className="settings-group">
          <Row
            title="发送给模型的内容"
            description="回答所需的消息与上下文会发送给你选择的模型供应商。"
          >
            <span className="setting-value">按请求发送</span>
          </Row>
          <Row
            title="上下文压缩"
            description="摘要用于之后的模型请求。已经保存的原始历史不会因为压缩而覆盖。"
          >
            <span className="setting-value">保留历史</span>
          </Row>
          <Row title="默认遥测上传" description="本地 Session 不会自动上传为服务端任务记录。">
            <span className="setting-value">未启用</span>
          </Row>
        </div>
      </section>
      <Status message={message} />
    </>
  );
}
