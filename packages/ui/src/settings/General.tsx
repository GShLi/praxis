import { useState } from 'react';
import { providerModelChoices } from '@praxis/model-core/provider-models';
import type { Provider } from '../client-types.ts';
import { Row } from './controls.tsx';

export function General({ providers }: { providers: Provider[] }) {
  const [sendMode, setSendMode] = useState(localStorage.getItem('praxis-send-mode') ?? 'enter');
  const [model, setModel] = useState(localStorage.getItem('praxis-default-provider') ?? '');
  const models = providerModelChoices(providers).filter((p) => p.enabled);
  return (
    <>
      <section className="settings-section">
        <h2>常规</h2>
        <div className="settings-group">
          <Row title="语言">
            <span className="setting-value">简体中文</span>
          </Row>
          <Row title="默认模型" description="开始新对话时优先选择此配置。">
            <select
              aria-label="默认模型"
              value={models.some((p) => p.id === model) ? model : ''}
              onChange={(e) => {
                setModel(e.target.value);
                localStorage.setItem('praxis-default-provider', e.target.value);
              }}
            >
              <option value="">首个可用模型</option>
              {models.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Row>
        </div>
      </section>
      <section className="settings-section">
        <h2>对话</h2>
        <div className="settings-group">
          <Row title="发送消息" description="使用 Shift + Enter 始终可以换行。">
            <select
              aria-label="发送消息快捷键"
              value={sendMode}
              onChange={(e) => {
                setSendMode(e.target.value);
                localStorage.setItem('praxis-send-mode', e.target.value);
              }}
            >
              <option value="enter">Enter 发送</option>
              <option value="modifier">⌘ / Ctrl + Enter 发送</option>
            </select>
          </Row>
        </div>
      </section>
      <p className="settings-footnote">操作偏好自动保存在当前客户端。</p>
    </>
  );
}
