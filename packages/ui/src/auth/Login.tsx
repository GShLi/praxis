import { useState } from 'react';

export function Login({
  desktop,
  error,
  onSubmit,
}: {
  desktop: boolean;
  error: string;
  onSubmit: (input: {
    username: string;
    password: string;
    serverUrl: string;
    apiKey: string;
  }) => Promise<void>;
}) {
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [serverUrl, setServerUrl] = useState('http://127.0.0.1:4310'),
    [apiKey, setApiKey] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <main className="login-page">
      <div className="login-brand">
        <span className="brand-mark">知</span>Praxis
      </div>
      <form
        className="login-form"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void onSubmit({ username, password, serverUrl, apiKey }).finally(() => {
            setBusy(false);
            setPassword('');
            setApiKey('');
          });
        }}
      >
        <h1>欢迎使用知行</h1>
        <p>{desktop ? '连接你的 Praxis 账户，开始对话或本地任务。' : '登录后，继续你的思考。'}</p>
        {desktop ? (
          <>
            <label>
              Praxis 服务地址
              <input
                type="url"
                value={serverUrl}
                required
                onChange={(e) => setServerUrl(e.target.value)}
              />
            </label>
            <label>
              Praxis API Key
              <input
                type="password"
                value={apiKey}
                required
                autoComplete="off"
                placeholder="pxk_.…"
                onChange={(e) => setApiKey(e.target.value)}
              />
            </label>
          </>
        ) : (
          <>
            <label>
              账号
              <input
                value={username}
                required
                autoComplete="username"
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label>
              密码
              <input
                type="password"
                value={password}
                required
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary-button" disabled={busy}>
          {busy ? '正在连接…' : '继续'}
        </button>
        <small>账号由你的 Praxis 管理员创建。</small>
      </form>
      <footer>知行合一 · From thought to action</footer>
    </main>
  );
}
