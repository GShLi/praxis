import { useEffect, useState } from 'react';
import type { ApiKeyInfo, PraxisClient, Profile } from '../client.ts';
import { CopyValue, errorText, Row, SettingsIcon, Status } from './controls.tsx';

export function Account({
  client,
  profile,
  profileError,
  logout,
}: {
  client: PraxisClient;
  profile: Profile | null;
  profileError: string;
  logout: () => Promise<void>;
}) {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]),
    [secret, setSecret] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<string | null>(null);
  const reload = async () => {
    if (client.keys) setKeys(await client.keys());
  };
  useEffect(() => {
    void reload().catch((e) => setMessage(errorText(e)));
  }, [client]);
  return (
    <>
      <section className="settings-account-card">
        <span className="settings-large-avatar">
          {profile?.username.slice(0, 1).toUpperCase() || '知'}
        </span>
        <div>
          <h3>{profile?.username || '已登录 Praxis'}</h3>
          <p>个人账户 · {client.desktop ? '客户端连接' : 'Web 会话'}</p>
        </div>
      </section>
      <Status message={profileError} />
      <section className="settings-section">
        <h2>登录信息</h2>
        <div className="settings-group">
          <Row title="登录方式">
            <span className="setting-value">
              {client.desktop ? 'Praxis API Key' : '账号与密码'}
            </span>
          </Row>
          {profile && (
            <Row title="账户 ID">
              <code className="settings-account-id">{profile.id}</code>
            </Row>
          )}
          <Row title="退出当前客户端" description="退出前会停止当前客户端的任务。">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void logout()
                  .catch((e) => setMessage(errorText(e)))
                  .finally(() => setBusy(false));
              }}
            >
              退出登录
            </button>
          </Row>
        </div>
      </section>
      {client.createKey && (
        <section className="settings-section">
          <div className="settings-section-toolbar">
            <div>
              <h2>客户端访问密钥</h2>
              <p>用 Praxis API Key 登录桌面端和 CLI。</p>
            </div>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void client.createKey!()
                  .then(async (value) => {
                    setSecret(value);
                    await reload();
                  })
                  .catch((e) => setMessage(errorText(e)))
                  .finally(() => setBusy(false));
              }}
            >
              <SettingsIcon name="plus" />
              创建 Key
            </button>
          </div>
          {secret && (
            <div className="settings-secret">
              <h3>请保存这个 Key</h3>
              <p>仅显示本次，离开此分类后将不再显示。</p>
              <code>{secret}</code>
              <div>
                <CopyValue value={secret} />
                <button className="text-button" onClick={() => setSecret('')}>
                  我已保存
                </button>
              </div>
            </div>
          )}
          {keys.length === 0 && <p className="settings-footnote">还没有为客户端创建访问密钥。</p>}
          {keys.map((key) => (
            <div className="api-key-row" key={key.id}>
              <div>
                <h3>
                  {key.name}
                  <span className="settings-badge">
                    {key.revoked_at
                      ? '已撤销'
                      : new Date(key.expires_at).getTime() < Date.now()
                        ? '已过期'
                        : '有效'}
                  </span>
                </h3>
                <p>
                  到期 {new Date(key.expires_at).toLocaleDateString('zh-CN')} ·{' '}
                  {key.last_used_at
                    ? `最近使用 ${new Date(key.last_used_at).toLocaleDateString('zh-CN')}`
                    : '尚未使用'}
                </p>
              </div>
              {!key.revoked_at &&
                (confirm === key.id ? (
                  <div className="inline-actions">
                    <button
                      className="secondary-button danger"
                      disabled={busy}
                      onClick={() => {
                        setBusy(true);
                        void client
                          .revokeKey?.(key.id)
                          .then(async () => {
                            await reload();
                            setConfirm(null);
                            setMessage('Key 已撤销；已签发的短期访问凭据会在到期后失效。');
                          })
                          .catch((e) => setMessage(errorText(e)))
                          .finally(() => setBusy(false));
                      }}
                    >
                      确认撤销
                    </button>
                    <button className="text-button" onClick={() => setConfirm(null)}>
                      取消
                    </button>
                  </div>
                ) : (
                  <button className="text-button danger" onClick={() => setConfirm(key.id)}>
                    撤销
                  </button>
                ))}
            </div>
          ))}
        </section>
      )}
      <Status message={message} />
    </>
  );
}
