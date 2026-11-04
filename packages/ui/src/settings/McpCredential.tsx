import { useMcpCredential } from './useMcpCredential.ts';
import type { McpState } from '../client-types.ts';

export function McpCredential({
  server,
  busy,
  save,
  clear,
}: {
  server: McpState['value'][number];
  busy: boolean;
  save(token: string): Promise<boolean>;
  clear(): Promise<boolean>;
}) {
  const { open, setOpen, token, setToken, submit, remove, cancel } = useMcpCredential(
    server.id,
    save,
    clear,
  );
  const label =
    server.credential?.storage === 'os'
      ? '系统凭据存储'
      : server.credential?.storage === 'memory'
        ? '仅本次运行有效'
        : server.credential?.storage === 'missing'
          ? '凭据不可用，请重新填写'
          : '未配置认证';
  if (server.transport.type !== 'streamable-http') return null;
  return (
    <div className="mcp-credential">
      <small>{label}</small>
      <button
        type="button"
        className="text-button"
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
      >
        设置 Bearer Token
      </button>
      {open && (
        <form
          className="settings-editor mcp-credential-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label>
            此服务器专用的 Bearer Token
            <input
              type="password"
              value={token}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              onChange={(event) => setToken(event.target.value)}
              required
            />
          </label>
          <p>仅用于 {server.transport.endpoint}。修改后需要重新检查连接并启用。</p>
          <button type="submit" className="secondary-button" disabled={busy || !token}>
            保存凭据
          </button>
          <button type="button" className="text-button" disabled={busy} onClick={cancel}>
            取消
          </button>
          {server.credential?.type !== 'none' && server.credential && (
            <button type="button" className="text-button" disabled={busy} onClick={remove}>
              清除本地凭据
            </button>
          )}
        </form>
      )}
    </div>
  );
}
