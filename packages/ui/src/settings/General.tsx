import { Select } from '../controls/Select.tsx';
import { useState } from 'react';
import { providerModelChoices } from '@praxis/model-core/provider-models';
import type { Provider } from '../client-types.ts';
import { Row } from './controls.tsx';
import { ModelSelect } from '../conversation/ModelSelect.tsx';

export function General({ providers }: { providers: Provider[] }) {
  const [sendMode, setSendMode] = useState(localStorage.getItem('praxis-send-mode') ?? 'enter');
  const [model, setModel] = useState(localStorage.getItem('praxis-default-provider') ?? '');
  const models = providerModelChoices(providers).filter((p) => p.enabled);
  return (
    <>
      <section className="settings-section">
        <div className="settings-group">
          <Row title="语言">
            <span className="setting-value">简体中文</span>
          </Row>
          <Row title="默认模型" description="开始新对话时优先选择此配置。">
            <ModelSelect
              choices={models}
              label="默认模型"
              value={models.some((p) => p.id === model) ? model : (models[0]?.id ?? '')}
              onChange={(value) => {
                setModel(value);
                localStorage.setItem('praxis-default-provider', value);
              }}
            />
          </Row>
        </div>
      </section>
      <section className="settings-section">
        <h2>对话</h2>
        <div className="settings-group">
          <Row title="发送消息" description="使用 Shift + Enter 始终可以换行。">
            <Select
              aria-label="发送消息快捷键"
              value={sendMode}
              onChange={(value) => {
                setSendMode(value);
                localStorage.setItem('praxis-send-mode', value);
              }}
            >
              <option value="enter">Enter 发送</option>
              <option value="modifier">⌘ / Ctrl + Enter 发送</option>
            </Select>
          </Row>
        </div>
      </section>
      <p className="settings-footnote">操作偏好自动保存在当前客户端。</p>
    </>
  );
}
