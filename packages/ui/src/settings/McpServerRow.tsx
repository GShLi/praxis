import { useState } from 'react';
import type { McpState, PraxisClient } from '../client-types.ts';
import { SettingsIcon } from './controls.tsx';
import { McpCredential } from './McpCredential.tsx';
import { McpOAuth } from './McpOAuth.tsx';
interface Actions {
  setBearer(token: string): Promise<boolean>;
  clearCredential(): Promise<boolean>;
  check(): Promise<boolean>;
  disable(): Promise<boolean>;
  enable(): Promise<boolean>;
  remove(): Promise<boolean>;
  refresh(): Promise<boolean>;
}
export function McpServerRow({
  server,
  client,
  busy,
  checked,
  storeRevision,
  edit,
  actions,
}: {
  server: McpState['value'][number];
  client: PraxisClient;
  busy: boolean;
  checked: boolean;
  storeRevision: number;
  edit(): void;
  actions: Actions;
}) {
  const [deleting, setDeleting] = useState(false);
  return (
    <article className="provider-row mcp-server">
      <span className="connection-symbol">
        <SettingsIcon name="connect" />
      </span>
      <div className="provider-summary">
        <h3>
          {server.displayName}
          <span className="settings-badge">{server.enabled ? '已启用' : '未启用'}</span>
        </h3>
        <p>{server.transport.endpoint ?? server.transport.executable}</p>
        {client.setMcpBearer && client.clearMcpCredential && (
          <McpCredential
            server={server}
            busy={busy}
            save={(token) => actions.setBearer(token)}
            clear={() => actions.clearCredential()}
          />
        )}
        <McpOAuth
          client={client}
          server={server}
          storeRevision={storeRevision}
          busy={busy}
          completed={actions.refresh}
        />
      </div>
      <div className="mcp-server-actions">
        <button
          className="secondary-button"
          disabled={busy || !client.testMcp}
          onClick={() => {
            void actions.check();
          }}
        >
          检查连接
        </button>
        {server.enabled ? (
          <button
            className="text-button"
            disabled={busy || !client.disableMcp}
            onClick={() => {
              void actions.disable();
            }}
          >
            停用
          </button>
        ) : (
          <button
            className="secondary-button"
            disabled={busy || !client.enableMcp || !checked}
            onClick={() => {
              void actions.enable();
            }}
          >
            启用 Agent 工具
          </button>
        )}
        <button
          className="text-button"
          disabled={busy || server.transport.type !== 'streamable-http'}
          onClick={edit}
        >
          编辑
        </button>
        <button
          className="text-button"
          disabled={busy || !client.deleteMcp}
          onClick={() => setDeleting(true)}
        >
          删除
        </button>
      </div>
      {deleting && (
        <div className="mcp-delete-confirmation" role="group" aria-label="确认删除 MCP 连接">
          <p>
            删除“{server.displayName}”及其本地凭据？活动操作会取消，远端授权仍需在服务商处撤销。
          </p>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void actions.remove()}
          >
            删除连接
          </button>
          <button className="text-button" disabled={busy} onClick={() => setDeleting(false)}>
            取消
          </button>
        </div>
      )}
    </article>
  );
}
