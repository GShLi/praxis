import { useId } from 'react';
import { serverLink } from './server-link.ts';
import type { useLoginForm } from './useLoginForm.ts';

type Fields = Pick<ReturnType<typeof useLoginForm>, 'values' | 'update' | 'busy'>;

export function DesktopLoginFields({ values, update, busy }: Fields) {
  const helpId = useId();
  const href = serverLink(values.serverUrl);
  return (
    <>
      <label>
        Praxis 服务地址
        <input
          type="url"
          value={values.serverUrl}
          required
          disabled={busy}
          autoComplete="url"
          spellCheck={false}
          aria-describedby={`${helpId}-server`}
          onChange={(e) => update('serverUrl', e.target.value)}
        />
        <small id={`${helpId}-server`}>填写 Praxis 网站地址；远程服务使用 HTTPS。</small>
      </label>
      <label>
        Praxis 客户端 Key
        <input
          type="password"
          value={values.apiKey}
          required
          disabled={busy}
          autoComplete="off"
          spellCheck={false}
          placeholder="pxk_.…"
          aria-describedby={helpId}
          onChange={(e) => update('apiKey', e.target.value)}
        />
      </label>
      <div className="login-key-help" id={helpId}>
        <p>使用 Praxis 客户端 Key 登录。模型厂商的 API Key 请在登录后的模型供应商设置中填写。</p>
        <ol>
          <li>
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                打开 Praxis 网站
              </a>
            ) : (
              '填写有效的 Praxis 服务地址后打开网站'
            )}
            ，使用账号和密码登录。
          </li>
          <li>进入「设置 → 账户 → 客户端访问密钥」，创建并复制 Key。</li>
          <li>回到这里粘贴 Key，连接客户端。</li>
        </ol>
      </div>
    </>
  );
}

export function WebLoginFields({ values, update, busy }: Fields) {
  return (
    <>
      <label>
        账号
        <input
          value={values.username}
          required
          disabled={busy}
          autoComplete="username"
          onChange={(e) => update('username', e.target.value)}
        />
      </label>
      <label>
        密码
        <input
          type="password"
          value={values.password}
          required
          disabled={busy}
          autoComplete="current-password"
          onChange={(e) => update('password', e.target.value)}
        />
      </label>
    </>
  );
}
