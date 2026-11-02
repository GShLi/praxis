import { useEffect, useState } from 'react';
import type { PluginReview, PluginState, PraxisClient } from '../client-types.ts';
import { Empty, errorText, SettingsIcon, Status } from './controls.tsx';

export function PluginSettings({ client }: { client: PraxisClient }) {
  const [state, setState] = useState<PluginState | null>(null),
    [source, setSource] = useState(''),
    [review, setReview] = useState<PluginReview | null>(null),
    [adding, setAdding] = useState(false),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const reload = async () => {
    if (client.plugins) setState(await client.plugins());
  };
  useEffect(() => {
    void reload().catch((e) => setMessage(errorText(e)));
  }, [client]);
  return (
    <>
      <div className="settings-section-toolbar">
        <span>{state ? `${state.value.length} 个已安装插件` : '正在读取插件…'}</span>
        <button
          className="primary-button compact"
          onClick={() => setAdding(true)}
          disabled={!client.inspectPlugin}
        >
          <SettingsIcon name="plus" />
          安装本地插件
        </button>
      </div>
      {state?.restartRequired && (
        <div className="settings-info-note">
          <SettingsIcon name="info" />
          <p>插件配置已变化。请重新登录或重启客户端，之后开始的新任务会使用新配置。</p>
        </div>
      )}
      {state?.value.length === 0 && !adding && (
        <Empty icon="plugin" title="按需要扩展知行">
          安装已构建的可信插件，添加工具、命令或模型适配器。
        </Empty>
      )}
      {state?.value.map((plugin) => (
        <article className="provider-row" key={plugin.manifest.id}>
          <span className="connection-symbol">
            <SettingsIcon name="plugin" />
          </span>
          <div className="provider-summary">
            <h3>
              {plugin.manifest.id}
              <span className="settings-badge">{plugin.enabled ? '已启用' : '已停用'}</span>
            </h3>
            <p>
              v{plugin.manifest.version} · {plugin.manifest.capabilities.join(' · ')}
            </p>
          </div>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void client
                .enablePlugin?.(plugin.manifest.id, !plugin.enabled, state.revision)
                .then(reload)
                .catch((e) => setMessage(errorText(e)))
                .finally(() => setBusy(false));
            }}
          >
            {plugin.enabled ? '停用' : '启用'}
          </button>
        </article>
      ))}
      {state?.failures?.map((failure) => (
        <p className="form-error" key={`${failure.id}:${failure.mode}`}>
          {failure.id} · {failure.mode} · {failure.code}
        </p>
      ))}
      {adding && (
        <form
          className="settings-editor"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setMessage('');
            void client
              .inspectPlugin?.(source)
              .then(setReview)
              .catch((error) => setMessage(errorText(error)))
              .finally(() => setBusy(false));
          }}
        >
          <div className="editor-heading">
            <h3>检查插件包</h3>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setAdding(false);
                setReview(null);
              }}
            >
              取消
            </button>
          </div>
          <label>
            已构建插件的目录
            <input
              value={source}
              required
              onChange={(e) => {
                setSource(e.target.value);
                setReview(null);
              }}
              placeholder="/path/to/your-plugin"
            />
          </label>
          <p className="field-help">目录中需包含 praxis-plugin.json，不会自动安装包内依赖。</p>
          <button className="secondary-button" disabled={busy}>
            {busy ? '正在检查…' : '检查包内容'}
          </button>
          {review && (
            <div className="plugin-review">
              <h4>
                {review.manifest.id} <span>v{review.manifest.version}</span>
              </h4>
              <p>{review.warning}</p>
              <dl>
                <dt>声明能力</dt>
                <dd>{review.manifest.capabilities.join(' · ')}</dd>
                <dt>包大小</dt>
                <dd>{(review.bytes / 1024).toFixed(1)} KiB</dd>
                <dt>内容摘要</dt>
                <dd className="settings-hash">{review.digest}</dd>
              </dl>
              <button
                type="button"
                className="primary-button compact"
                disabled={busy || !state}
                onClick={() => {
                  setBusy(true);
                  void client
                    .installPlugin?.(source, review.digest, state!.revision)
                    .then(async () => {
                      await reload();
                      setReview(null);
                      setAdding(false);
                      setMessage('插件已安装，默认停用。核对后可启用。');
                    })
                    .catch((error) => setMessage(errorText(error)))
                    .finally(() => setBusy(false));
                }}
              >
                信任此来源并安装
              </button>
            </div>
          )}
        </form>
      )}
      <Status message={message} />
      <p className="settings-footnote">
        插件运行在 Host 权限内。仅安装你信任的代码；模型不能安装或启用插件。
      </p>
    </>
  );
}
