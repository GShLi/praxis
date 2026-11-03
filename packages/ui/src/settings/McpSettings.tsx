import { McpServerRow } from './McpServerRow.tsx';
import { useState } from 'react';
import type { PraxisClient, McpState } from '../client-types.ts';
import { Empty, SettingsIcon, Status } from './controls.tsx';
import { McpEditor } from './McpEditor.tsx';
import { useMcpSettings } from './useMcpSettings.ts';

export function McpSettings({ client }: { client: PraxisClient }) {
  const [editing, setEditing] = useState<McpState['value'][number] | 'new' | null>(null);
  const settings = useMcpSettings(client);
  const { state, message, busy, checked } = settings;
  return (
    <>
      <div className="settings-section-toolbar">
        <span>{state ? `${state.value.length} 个服务器` : '正在读取连接配置…'}</span>
        <button
          className="primary-button compact"
          disabled={busy || !client.saveMcp || !state}
          onClick={() => setEditing('new')}
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
        <McpServerRow
          key={server.id}
          server={server}
          client={client}
          busy={busy}
          checked={checked[server.id] === server.revision}
          storeRevision={state.revision}
          edit={() => setEditing(server)}
          actions={{
            setBearer: (token) => settings.setBearer(server.id, server.revision, token),
            clearCredential: () => settings.clearCredential(server.id, server.revision),
            check: () => settings.check(server.id, server.revision),
            disable: () => settings.disable(server.id),
            enable: () => settings.enable(server.id, server.revision),
            remove: () => settings.remove(server.id, server.revision),
            refresh: settings.refresh,
          }}
        />
      ))}
      {editing && (
        <McpEditor
          key={editing === 'new' ? 'new' : editing.id}
          busy={busy}
          {...(editing === 'new' ? {} : { initial: editing })}
          save={(config) => settings.save(config, editing === 'new' ? null : editing.revision)}
          cancel={() => setEditing(null)}
        />
      )}
      <Status message={message} />
      <div className="settings-info-note">
        <SettingsIcon name="info" />
        <p>
          保存配置不会连接服务器。检查连接会访问地址并读取目录，检查后可明确启用工具。 启用后，Agent
          可按需读取目录；每次业务调用和资源读取均需确认参数和目标地址。HTTP 连接支持无认证、Bearer
          和 OAuth。系统凭据存储不可用时只保留本次运行的内存凭据；本地 stdio 尚未接入。
        </p>
      </div>
    </>
  );
}
