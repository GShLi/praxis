import { useState } from 'react';
import type { ProviderEditorState } from './useProviderEditor.ts';
import { ProviderModelFields } from './ProviderModelFields.tsx';

export function ProviderModelPicker({ state }: { state: ProviderEditorState }) {
  const { draft, change, catalog, baseUrl, canUseSavedKey } = state;
  const [search, setSearch] = useState(''),
    [manual, setManual] = useState(Boolean(draft.pendingModel));
  const modelId = draft.pendingModel;
  const setModelId = (pendingModel: string) => change({ pendingModel });
  const [message, setMessage] = useState('');
  const add = (raw: string) => {
    const model = raw.trim();
    if (!model || draft.models.some((m) => m.model === model)) {
      setMessage('模型 ID 为空或已添加。');
      return;
    }
    if (draft.models.length >= 100) {
      setMessage('每个供应商最多保存 100 个模型。');
      return;
    }
    change({
      models: [
        ...draft.models,
        {
          id: crypto.randomUUID(),
          model,
          contextWindow: 128000,
          maxOutputTokens: 4096,
          enabled: true,
        },
      ],
    });
    setModelId('');
    setMessage('');
  };
  const visible = catalog.models.filter((m) =>
    m.id.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <section className="provider-model-picker">
      <div className="model-picker-heading">
        <h3>
          模型 <span>{draft.models.length}</span>
        </h3>
        <button
          type="button"
          className="secondary-button"
          disabled={
            catalog.state === 'loading' ||
            !baseUrl ||
            draft.adapter !== 'openai-compatible' ||
            (!draft.key.trim() && !canUseSavedKey)
          }
          onClick={() => void state.fetchModels()}
        >
          {catalog.state === 'loading' ? '正在获取…' : '获取模型列表'}
        </button>
      </div>
      {catalog.state === 'idle' && (
        <p className="field-help">填写地址和 Key 后获取模型列表，选择要使用的模型。</p>
      )}
      {catalog.state === 'error' && (
        <p className="settings-feedback error" role="alert">
          {catalog.error} 可重试或手动添加模型。
        </p>
      )}
      {catalog.state === 'success' && (
        <div className="catalog-result">
          <p className="field-help" role="status">
            {catalog.checkedAt} · 已获取 {catalog.models.length} 个模型；尚未验证生成能力。
          </p>
          {catalog.models.length ? (
            <>
              <input
                aria-label="搜索可用模型"
                type="search"
                placeholder="搜索模型 ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="catalog-options" aria-label="可用模型">
                {visible.map((model) => {
                  const added = draft.models.some((m) => m.model === model.id);
                  return (
                    <button
                      type="button"
                      key={model.id}
                      disabled={added}
                      onClick={() => add(model.id)}
                    >
                      <span>{model.id}</span>
                      <span>{added ? '已添加' : '＋ 添加'}</span>
                    </button>
                  );
                })}
                {!visible.length && <p className="field-help">没有匹配的模型。</p>}
              </div>
            </>
          ) : (
            <p className="field-help">供应商返回了空列表，可手动填写模型 ID。</p>
          )}
        </div>
      )}
      <button
        type="button"
        className="text-button manual-model-toggle"
        aria-expanded={manual}
        onClick={() => setManual(!manual)}
      >
        {manual ? '收起手动添加' : '手动添加模型'}
      </button>
      {manual && (
        <div className="manual-model-entry">
          <input
            aria-label="手动模型 ID"
            maxLength={128}
            placeholder="填写模型 ID"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add(modelId);
              }
            }}
          />
          <button
            type="button"
            className="secondary-button"
            disabled={!modelId.trim()}
            onClick={() => add(modelId)}
          >
            添加模型
          </button>
        </div>
      )}
      {message && (
        <p role="alert" className="field-help">
          {message}
        </p>
      )}
      <div className="selected-provider-models">
        {draft.models.map((model) => (
          <ProviderModelFields
            key={model.id}
            model={model}
            update={(patch) =>
              change({
                models: draft.models.map((m) => (m.id === model.id ? { ...m, ...patch } : m)),
              })
            }
            remove={() => change({ models: draft.models.filter((m) => m.id !== model.id) })}
          />
        ))}
      </div>
      {!draft.models.length && <p className="field-help">尚未添加模型。保存前至少选择一个。</p>}
    </section>
  );
}
