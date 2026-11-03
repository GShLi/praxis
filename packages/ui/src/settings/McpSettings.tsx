import { McpCredential } from './McpCredential.tsx';
import { useState } from 'react';
import type { PraxisClient } from '../client-types.ts';
import { Empty, SettingsIcon, Status } from './controls.tsx';
import { McpEditor } from './McpEditor.tsx';
import { useMcpSettings } from './useMcpSettings.ts';

export function McpSettings({ client }: { client: PraxisClient }) {
  const [editing, setEditing] = useState(false);
  const settings = useMcpSettings(client);
  const { state, message, busy, checked } = settings;
  return (
    <>
      <div className="settings-section-toolbar">
        <span>{state ? `${state.value.length} 个服务器` : '正在读取连接配置…'}</span>
        <button
          className="primary-button compact"
          disabled={busy || !client.saveMcp || !state}
          onClick={() => setEditing(true)}
        >
          <SettingsIcon name="plus" />
          添加连接
        </button>
      </div>
      {state?.value.length === 0 && !editing && (
        <Empty icon="connect" title="还没有 MCP 连接">
          添加服务器，为 Agent 提供外部工具。
        </Empty>
      )}
      {state?.value.map((server) => (
        <article className="provider-row" key={server.id}>
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
                save={(token) => settings.setBearer(server.id, server.revision, token)}
                clear={() => settings.clearCredential(server.id, server.revision)}
              />
            )}
          </div>
          <button
            className="secondary-button"
            disabled={busy || !client.testMcp}
            onClick={() => {
              void settings.check(server.id, server.revision);
            }}
          >
            检查连接
          </button>
          {server.enabled ? (
            <button
              className="text-button"
              disabled={busy || !client.disableMcp}
              onClick={() => {
                void settings.disable(server.id);
              }}
            >
              停用
            </button>
          ) : (
            <button
              className="secondary-button"
              disabled={busy || !client.enableMcp || checked[server.id] !== server.revision}
              onClick={() => {
                void settings.enable(server.id, server.revision);
              }}
            >
              启用 Agent 工具
            </button>
          )}
        </article>
      ))}
      {editing && <McpEditor busy={busy} save={settings.save} cancel={() => setEditing(false)} />}
      <Status message={message} />
      <div className="settings-info-note">
        <SettingsIcon name="info" />
        <p>
          保存配置不会连接服务器。检查连接会访问地址并读取目录，检查后可明确启用工具。 启用后，Agent
          可按需读取目录；每次业务调用和资源读取均需确认参数和目标地址。当前支持无认证或 Bearer HTTP
          工具、文本资源与提示词。系统凭据存储不可用时只保留本次运行的内存凭据；stdio、OAuth
          尚未接入。
        </p>
      </div>
    </>
  );
}
