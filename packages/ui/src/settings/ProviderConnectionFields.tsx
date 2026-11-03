import type { ProviderEditorState } from './useProviderEditor.ts';
const presets = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'custom', name: '自定义供应商', baseUrl: '' },
];
export function ProviderConnectionFields({
  state,
  creating,
}: {
  state: ProviderEditorState;
  creating: boolean;
}) {
  const { draft, change, canUseSavedKey } = state;
  return (
    <>
      {creating && (
        <div className="provider-presets" aria-label="供应商预设">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="secondary-button"
              onClick={() =>
                change({ name: preset.name, baseUrl: preset.baseUrl, adapter: 'openai-compatible' })
              }
            >
              {preset.name}
            </button>
          ))}
        </div>
      )}
      <div className="settings-fields">
        <label>
          供应商名称
          <input
            autoFocus
            data-dialog-focus
            required
            maxLength={100}
            value={draft.name}
            onChange={(e) => change({ name: e.target.value })}
          />
        </label>
        <label>
          Base URL
          <input
            required
            type="url"
            maxLength={2048}
            placeholder="https://api.example.com/v1"
            value={draft.baseUrl}
            onChange={(e) => change({ baseUrl: e.target.value })}
          />
        </label>
      </div>
      <p className="field-help">填写兼容接口的 HTTPS API 根地址，包含厂商要求的 /v1 等路径。</p>
      <label>
        API Key
        <input
          type="password"
          autoComplete="off"
          maxLength={4096}
          required={!canUseSavedKey}
          placeholder={canUseSavedKey ? '已保存；留空保留原 Key' : '填写此供应商的 API Key'}
          value={draft.key}
          onChange={(e) => change({ key: e.target.value })}
        />
      </label>
      <p className="field-help">
        此供应商的所有模型共用一个 Key。更换地址或适配器后需填写对应的 Key。
      </p>
      <details className="provider-advanced">
        <summary>连接高级设置</summary>
        <label>
          模型适配器
          <input
            required
            maxLength={180}
            value={draft.adapter}
            onChange={(e) => change({ adapter: e.target.value })}
          />
        </label>
        <p className="field-help">
          默认 openai-compatible；插件填写 插件ID/适配器ID，运行端须已启用该插件。
        </p>
      </details>
    </>
  );
}
