import type { PraxisClient, Profile } from '../client-types.ts';
import { CopyValue, Row, SettingsIcon, Status } from './controls.tsx';
import { SettingsLoadState } from './SettingsLoadState.tsx';
import { useAccountSettings } from './useAccountSettings.ts';

export function Account({
  client,
  profile,
  profileError,
  reloadProfile,
  logout,
}: {
  client: PraxisClient;
  profile: Profile | null;
  profileError: string;
  reloadProfile?: () => Promise<boolean>;
  logout: () => Promise<void>;
}) {
  const settings = useAccountSettings(client, logout);
  const { keys, secret, confirm, busy } = settings;
  const { data, status, feedback } = keys;
  const globalFeedback = status !== 'ready' || !data?.some((key) => key.id === feedback.target);
  return (
    <>
      <section className="settings-account-card">
        <span className="settings-large-avatar">
          {profile?.username.slice(0, 1).toUpperCase() || '知'}
        </span>
        <div>
          <h3>{profile?.username || (profileError ? '账户信息未能读取' : '已登录 Praxis')}</h3>
          <p>个人账户 · {client.desktop ? '客户端连接' : 'Web 会话'}</p>
        </div>
      </section>
      <Status message={profileError} variant="error" />
      {profileError && reloadProfile && (
        <button className="secondary-button" onClick={() => void reloadProfile()}>
          重试读取账户信息
        </button>
      )}
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
              onClick={() => void settings.logout()}
            >
              退出登录
            </button>
          </Row>
        </div>
        <Status message={settings.logoutError} variant="error" />
      </section>
      {(client.keys || client.createKey) && (
        <section className="settings-section">
          <div className="settings-section-toolbar">
            <div>
              <h2>客户端访问密钥</h2>
              <p>用 Praxis API Key 登录桌面端和 CLI。</p>
            </div>
            <button
              className="secondary-button"
              disabled={busy || status !== 'ready' || Boolean(secret) || !client.createKey}
              onClick={() => void settings.create()}
            >
              <SettingsIcon name="plus" />
              创建 Key
            </button>
          </div>
          <SettingsLoadState
            status={status}
            error={keys.error}
            retry={keys.reload}
            label="访问密钥"
          />
          {globalFeedback && <Status {...feedback} />}
          {secret && (
            <div className="settings-secret">
              <h3>请保存这个 Key</h3>
              <p>仅显示本次，离开此分类后将不再显示。</p>
              <code>{secret}</code>
              <div>
                <CopyValue value={secret} />
                <button className="text-button" onClick={settings.dismissSecret}>
                  我已保存
                </button>
              </div>
            </div>
          )}
          {status === 'ready' && data?.length === 0 && (
            <p className="settings-footnote">还没有为客户端创建访问密钥。</p>
          )}
          {status === 'ready' &&
            data?.map((key) => (
              <div key={key.id}>
                <div className="api-key-row">
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
                          disabled={busy || !client.revokeKey}
                          onClick={() => void settings.revoke(key.id)}
                        >
                          确认撤销
                        </button>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => settings.setConfirm(null)}
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        className="text-button danger"
                        disabled={busy || !client.revokeKey}
                        onClick={() => settings.setConfirm(key.id)}
                      >
                        撤销
                      </button>
                    ))}
                </div>
                {feedback.target === key.id && <Status {...feedback} />}
              </div>
            ))}
        </section>
      )}
    </>
  );
}
