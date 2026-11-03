import { useState } from 'react';
import { providerModels, modelSelectionId } from '@praxis/model-core/provider-models';
import type { Provider } from '../client-types.ts';
export function ProviderModelsTab({
  provider,
  defaultId,
  setDefault,
  edit,
}: {
  provider: Provider;
  defaultId: string;
  setDefault: (id: string) => void;
  edit: () => void;
}) {
  const [search, setSearch] = useState('');
  const visible = providerModels(provider).filter((m) =>
    m.model.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <div role="tabpanel" id="provider-panel-models" aria-labelledby="provider-tab-models">
      <div className="provider-model-toolbar">
        <input
          type="search"
          aria-label="搜索已配置模型"
          placeholder="搜索模型…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="secondary-button" onClick={edit}>
          管理模型
        </button>
      </div>
      {visible.map((model) => {
        const id = modelSelectionId(provider.id, model.id, provider.defaultModelId);
        return (
          <div className="provider-detail-model" key={model.id}>
            <div>
              <h4>
                {model.model}{' '}
                {defaultId === id && <span className="settings-badge">当前客户端默认</span>}
              </h4>
              <p>
                {model.enabled ? '已启用' : '已停用'} · 上下文{' '}
                {model.contextWindow.toLocaleString()} · 最大输出{' '}
                {model.maxOutputTokens.toLocaleString()}
              </p>
            </div>
            <button
              className="secondary-button"
              disabled={!model.enabled || !provider.enabled || defaultId === id}
              onClick={() => setDefault(id)}
            >
              {defaultId === id ? '默认模型' : '设为默认'}
            </button>
          </div>
        );
      })}
      {!visible.length && <p className="field-help">没有匹配的模型。</p>}
      <p className="field-help">
        默认模型仅影响当前客户端的新对话；模型参数与启用状态在“管理模型”中修改。
      </p>
    </div>
  );
}
