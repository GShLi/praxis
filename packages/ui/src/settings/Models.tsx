import { useState } from 'react';
import type { PraxisClient, Provider } from '../client-types.ts';
import { Empty, errorText, SettingsIcon, Status } from './controls.tsx';
import { ProviderEditor } from './ProviderEditor.tsx';

export function Models({
  client,
  providers,
  saved,
}: {
  client: PraxisClient;
  providers: Provider[];
  saved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null),
    [confirm, setConfirm] = useState<string | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const selected = providers.find((p) => p.id === editing);
  return (
    <>
      <div className="settings-section-toolbar">
        <span>{providers.length} 个模型配置</span>
        <button
          className="primary-button compact"
          onClick={() => {
            setEditing('new');
            setMessage('');
          }}
        >
          <SettingsIcon name="plus" />
          添加提供商
        </button>
      </div>
      {!providers.length && editing === null && (
        <Empty icon="model" title="添加你的第一个模型">
          填写模型提供商与 API Key 后，即可开始对话。
        </Empty>
      )}
      <div className="provider-list">
        {providers.map((p) => (
          <article className={`provider-row ${editing === p.id ? 'editing' : ''}`} key={p.id}>
            <span className="provider-symbol">{p.name.slice(0, 1).toUpperCase()}</span>
            <div className="provider-summary">
              <h3>
                {p.name}
                <span className={`settings-badge ${p.enabled ? 'available' : ''}`}>
                  {p.enabled ? '已启用' : '已停用'}
                </span>
              </h3>
              <p>
                {p.model} <span>·</span> {p.keyConfigured ? 'Key 已配置' : '未配置 Key'}
              </p>
            </div>
            <button
              className="secondary-button"
              onClick={() => {
                setEditing(p.id);
                setMessage('');
              }}
            >
              管理
            </button>
          </article>
        ))}
      </div>
      {editing !== null && (
        <ProviderEditor
          key={editing}
          provider={selected}
          client={client}
          close={() => setEditing(null)}
          saved={async () => {
            await saved();
            setEditing(null);
            setMessage('模型配置已保存。');
          }}
        />
      )}
      {selected && client.deleteProvider && (
        <div className="settings-delete-row">
          {confirm === selected.id ? (
            <>
              <p>删除“{selected.name}”及其保存的 Key？已有会话历史会保留。</p>
              <button
                className="secondary-button danger"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void client.deleteProvider!(selected.id, selected.revision)
                    .then(async () => {
                      await saved();
                      setEditing(null);
                      setConfirm(null);
                      setMessage('模型配置已删除。');
                    })
                    .catch((e) => setMessage(errorText(e)))
                    .finally(() => setBusy(false));
                }}
              >
                确认删除
              </button>
              <button className="text-button" onClick={() => setConfirm(null)}>
                取消
              </button>
            </>
          ) : (
            <button className="text-button danger" onClick={() => setConfirm(selected.id)}>
              删除此模型配置
            </button>
          )}
        </div>
      )}
      <Status message={message} />
      <div className="settings-info-note">
        <SettingsIcon name="info" />
        <p>
          ChatBot 与 Agent 共用同一份配置。
          {client.desktop
            ? '本地任务从 Praxis 获取配置后，直接请求模型厂商。'
            : 'Web 对话由 Praxis 服务端调用模型，厂商 Key 不会返回浏览器。'}
        </p>
      </div>
    </>
  );
}
