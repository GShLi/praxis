import { useEffect, useState } from 'react';
import type { PraxisClient } from '../client-types.ts';
import { Empty, SettingsIcon, Status } from './controls.tsx';
import { PluginEditor } from './PluginEditor.tsx';
import { SettingsLoadState } from './SettingsLoadState.tsx';
import { usePluginSettings } from './usePluginSettings.ts';

export function PluginSettings({ client }: { client: PraxisClient }) {
  const [adding, setAdding] = useState(false);
  const settings = usePluginSettings(client);
  const { data: state, status, error, busy, feedback } = settings;
  useEffect(() => setAdding(false), [client]);
  const visibleFeedback =
    !adding &&
    (status !== 'ready' || !state?.value.some((plugin) => plugin.manifest.id === feedback.target));
  return (
    <>
      <div className="settings-section-toolbar">
        <span>
          {status === 'ready' && state ? `${state.value.length} 个已安装插件` : '本地插件'}
        </span>
        <button
          className="primary-button compact"
          onClick={() => {
            settings.clearFeedback();
            setAdding(true);
          }}
          disabled={busy || status !== 'ready' || !client.inspectPlugin || !client.installPlugin}
        >
          <SettingsIcon name="plus" />
          安装本地插件
        </button>
      </div>
      <SettingsLoadState status={status} error={error} retry={settings.reload} label="插件" />
      {visibleFeedback && <Status {...feedback} />}
      {state?.restartRequired && (
        <div className="settings-info-note">
          <SettingsIcon name="info" />
          <p>插件配置已变化。请重新登录或重启客户端，之后开始的新任务会使用新配置。</p>
        </div>
      )}
      {status === 'ready' && state?.value.length === 0 && (
        <Empty icon="plugin" title="按需要扩展知行">
          安装已构建的可信插件，添加工具、命令或模型适配器。
        </Empty>
      )}
      {status === 'ready' &&
        state?.value.map((plugin) => (
          <div key={plugin.manifest.id}>
            <article className="provider-row">
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
                disabled={busy || !client.enablePlugin}
                onClick={() => void settings.toggle(plugin.manifest.id, !plugin.enabled)}
              >
                {plugin.enabled ? '停用' : '启用'}
              </button>
            </article>
            {feedback.target === plugin.manifest.id && <Status {...feedback} />}
          </div>
        ))}
      {status === 'ready' &&
        state?.failures?.map((failure) => (
          <Status
            variant="error"
            key={`${failure.id}:${failure.mode}`}
            message={`${failure.id} · ${failure.mode} · ${failure.code}`}
          />
        ))}
      {adding && (
        <PluginEditor
          client={client}
          saving={busy}
          canSave={status === 'ready'}
          feedback={feedback.target === 'editor' ? feedback : undefined}
          save={settings.install}
          retry={settings.reload}
          close={() => setAdding(false)}
        />
      )}
      <p className="settings-footnote">
        插件运行在 Host 权限内。仅安装你信任的代码；模型不能安装或启用插件。
      </p>
    </>
  );
}
