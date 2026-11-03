import type { ProviderModel } from '@praxis/model-core/provider-models';

export function ProviderModelFields({
  model,
  update,
  remove,
}: {
  model: ProviderModel;
  update: (patch: Partial<ProviderModel>) => void;
  remove: () => void;
}) {
  return (
    <div className="provider-model-field">
      <div className="model-field-heading">
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={model.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          <span>{model.model}</span>
        </label>
        <button
          type="button"
          className="text-button"
          aria-label={`移除模型 ${model.model}`}
          onClick={remove}
        >
          移除
        </button>
      </div>
      <details
        onInvalidCapture={(e) => {
          e.currentTarget.open = true;
        }}
      >
        <summary>模型参数</summary>
        <label>
          模型 ID
          <input
            required
            maxLength={128}
            value={model.model}
            onChange={(e) => update({ model: e.target.value })}
          />
        </label>
        <div className="settings-fields">
          <label>
            上下文窗口
            <input
              type="number"
              required
              min={8192}
              max={2000000}
              value={model.contextWindow}
              onChange={(e) => update({ contextWindow: Number(e.target.value) })}
            />
          </label>
          <label>
            最大输出 Tokens
            <input
              type="number"
              required
              min={256}
              max={393216}
              value={model.maxOutputTokens}
              onChange={(e) => update({ maxOutputTokens: Number(e.target.value) })}
            />
          </label>
        </div>
        <p className="field-help">容量需按厂商资料调整；最大输出须小于上下文窗口的一半。</p>
      </details>
    </div>
  );
}
