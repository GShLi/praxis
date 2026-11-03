import { useState } from 'react';
import type { McpState, PraxisClient } from '../client-types.ts';
import { Status } from './controls.tsx';
import { useMcpOAuth } from './useMcpOAuth.ts';

export function McpOAuth({
  client,
  server,
  storeRevision,
  busy,
  completed,
}: {
  client: PraxisClient;
  server: McpState['value'][number];
  storeRevision: number;
  busy: boolean;
  completed(): Promise<boolean>;
}) {
  const [open, setOpen] = useState(false),
    [issuer, setIssuer] = useState('');
  const [clientId, setClientId] = useState(''),
    [redirectUri, setRedirectUri] = useState('http://127.0.0.1:4319/oauth/callback');
  const [scopes, setScopes] = useState(''),
    [allowPrivateIssuer, setAllowPrivateIssuer] = useState(false);
  const auth = useMcpOAuth(client, completed);
  if (server.transport.type !== 'streamable-http' || !client.startMcpOAuth) return null;
  return (
    <div className="mcp-credential">
      <button
        type="button"
        className="text-button"
        disabled={busy || auth.busy}
        onClick={() => setOpen((value) => !value)}
      >
        OAuth 浏览器授权
      </button>
      {open && (
        <form
          className="settings-editor mcp-credential-form"
          onSubmit={(event) => {
            event.preventDefault();
            void auth.start({
              serverId: server.id,
              expectedStoreRevision: storeRevision,
              expectedRevision: server.revision,
              issuer,
              clientId,
              redirectUri,
              scopes: scopes.split(/\s+/).filter(Boolean),
              allowPrivateIssuer,
            });
          }}
        >
          <label>
            授权服务器（Issuer）
            <input
              type="url"
              required
              value={issuer}
              disabled={busy || auth.busy}
              onChange={(e) => setIssuer(e.target.value)}
              placeholder="https://auth.example.com"
            />
          </label>
          <label>
            公共客户端 ID 或 HTTPS Metadata URL
            <input
              required
              value={clientId}
              disabled={busy || auth.busy}
              onChange={(e) => setClientId(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label>
            已注册的本机回调地址
            <input
              type="url"
              required
              value={redirectUri}
              disabled={busy || auth.busy}
              onChange={(e) => setRedirectUri(e.target.value)}
            />
          </label>
          <label>
            权限范围（用空格分隔）
            <input
              value={scopes}
              disabled={busy || auth.busy}
              onChange={(e) => setScopes(e.target.value)}
              placeholder="docs:read"
            />
          </label>
          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={allowPrivateIssuer}
              disabled={busy || auth.busy}
              onChange={(e) => setAllowPrivateIssuer(e.target.checked)}
            />
            允许此授权服务器使用私网地址
          </label>
          <p>请先在授权服务器注册公共客户端和上方回调地址。授权窗口有效期为 5 分钟。</p>
          {!auth.flow && (
            <button className="secondary-button" type="submit" disabled={busy || auth.busy}>
              开始授权
            </button>
          )}
          {auth.flow && (
            <>
              <a
                href={auth.flow.authorizationUrl}
                target="_blank"
                rel="noreferrer"
                className="secondary-button"
              >
                打开浏览器完成授权
              </a>
              <button className="text-button" type="button" onClick={() => void auth.cancel()}>
                取消授权
              </button>
            </>
          )}
          <Status message={auth.message} />
        </form>
      )}
    </div>
  );
}
