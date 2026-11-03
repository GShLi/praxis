import { useId } from 'react';
import type { PraxisClient, Provider } from '../client-types.ts';
import { ModelCapacity } from './ModelCapacity.tsx';
import { useProviderEditor } from './useProviderEditor.ts';

export function ProviderEditor({
  provider,
  client,
  close,
  saved,
}: {
  provider: Provider | undefined;
  client: PraxisClient;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const {
    name,
    setName,
    adapter,
    setAdapter,
    baseUrl,
    setBaseUrl,
    model,
    setModel,
    key,
    setKey,
    windowSize,
    setWindowSize,
    output,
    setOutput,
    enabled,
    setEnabled,
    busy,
    error,
    models,
    catalogState,
    catalogError,
    manual,
    setManual,
    endpoint,
    canUseSavedKey,
    fetching,
    resetCatalog,
    fetchModels,
    submit,
  } = useProviderEditor(provider, client, saved);
  const modelField = useId();
  return (
    <form className="settings-editor" onSubmit={submit}>
      <div className="editor-heading">
        <h3>{provider ? '编辑模型配置' : '添加模型提供商'}</h3>
        <button type="button" className="text-button" onClick={close}>
          取消
        </button>
      </div>
      <div className="settings-fields">
        <label>
          显示名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            disabled={busy}
          />
        </label>
        <label>
          Base URL
          <input
            type="url"
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              resetCatalog();
            }}
            required
            maxLength={2048}
            placeholder="https://api.example.com/v1"
            disabled={busy}
          />
        </label>
      </div>
      <p className="field-help">
        支持 OpenAI 兼容的 Chat Completions 接口。请填写 HTTPS API 根地址，包含厂商要求的 /v1
        等路径。
      </p>
      <label>
        API Key
        <input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            resetCatalog();
          }}
          required={!canUseSavedKey}
          disabled={busy}
          maxLength={4096}
          placeholder={canUseSavedKey ? '已保存；留空使用原 Key' : '输入此地址对应的 API Key'}
        />
      </label>
      <p className="field-help">
        {provider && !canUseSavedKey
          ? 'Base URL 或适配器已改变，请重新填写对应的 API Key。'
          : '密钥用于获取模型列表和生成回答，保存后不再显示原值。'}
      </p>
      <div className="model-picker">
        <div className="model-picker-heading">
          <label htmlFor={modelField}>模型</label>
          <button
            type="button"
            className="text-button"
            disabled={busy || fetching || adapter !== 'openai-compatible'}
            onClick={() => setManual(!manual)}
          >
            {manual ? '从列表选择' : '手动输入模型 ID'}
          </button>
        </div>
        <div className="model-picker-controls">
          {manual ? (
            <input
              id={modelField}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="输入模型 ID"
              required
              maxLength={128}
              disabled={busy}
            />
          ) : (
            <select
              id={modelField}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              required
              disabled={busy || fetching || (!models.length && !model)}
            >
              <option value="" disabled>
                {fetching ? '正在获取模型…' : '获取列表后选择模型'}
              </option>
              {model && !models.some((item) => item.id === model) && (
                <option value={model}>
                  {model}
                  {catalogState === 'success' ? '（不在返回列表中）' : '（当前配置）'}
                </option>
              )}
              {models.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="secondary-button"
            disabled={
              busy ||
              fetching ||
              adapter !== 'openai-compatible' ||
              !endpoint ||
              (!key.trim() && !canUseSavedKey)
            }
            onClick={() => {
              void fetchModels();
            }}
          >
            {fetching ? '正在获取…' : catalogState === 'success' ? '刷新列表' : '获取模型列表'}
          </button>
        </div>
        <div aria-live="polite" className="model-picker-feedback">
          {fetching && <p className="field-help">正在连接供应商，获取可用模型…</p>}
          {catalogState === 'success' && (
            <p className="field-help">
              {models.length
                ? `已获取 ${models.length} 个模型。`
                : '供应商返回了空列表，可以刷新重试或手动输入模型 ID。'}
            </p>
          )}
          {catalogError && <p className="form-error">{catalogError} 可重试或切换为手动输入。</p>}
          {catalogState === 'idle' && (
            <p className="field-help">
              填写地址和 Key 后获取列表，无需记住模型 ID。此操作不会保存配置。
            </p>
          )}
        </div>
      </div>
      <ModelCapacity
        adapter={adapter}
        setAdapter={(value) => {
          setAdapter(value);
          resetCatalog();
          setManual(value !== 'openai-compatible');
        }}
        windowSize={windowSize}
        setWindowSize={setWindowSize}
        output={output}
        setOutput={setOutput}
      />
      <label className="settings-checkbox">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        启用此模型配置
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="settings-form-footer">
        <button type="button" className="secondary-button" onClick={close}>
          取消
        </button>
        <button
          className="primary-button compact"
          disabled={busy || fetching || !model.trim() || !endpoint}
        >
          {busy ? '正在保存…' : '保存配置'}
        </button>
      </div>
    </form>
  );
}
