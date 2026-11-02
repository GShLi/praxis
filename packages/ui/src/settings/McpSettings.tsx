import { useEffect, useState } from 'react';
import type { McpState, PraxisClient } from '../client.ts';
import { Empty, errorText, SettingsIcon, Status } from './controls.tsx';

export function McpSettings({ client }: { client: PraxisClient }) {
  const [state, setState] = useState<McpState | null>(null),
    [editing, setEditing] = useState(false),
    [name, setName] = useState(''),
    [endpoint, setEndpoint] = useState(''),
    [namespace, setNamespace] = useState(''),
    [privateHost, setPrivateHost] = useState(false),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const reload = async () => {
    if (client.mcpServers) setState(await client.mcpServers());
  };
  useEffect(() => {
    void reload().catch((e) => setMessage(errorText(e)));
  }, [client]);
  return (
    <>
      <div className="settings-section-toolbar">
        <span>{state ? `${state.value.length} 个服务器` : '正在读取连接配置…'}</span>
        <button
          className="primary-button compact"
          disabled={!client.saveMcp || !state}
          onClick={() => setEditing(true)}
        >
          <SettingsIcon name="plus" />
          添加连接
        </button>
      </div>
      {state?.value.length === 0 && !editing && (
        <Empty icon="connect" title="还没有 MCP 连接">
          添加你使用的服务器，为 Agent 提供外部工具与资源。
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
          </div>
          <button
            className="secondary-button"
            disabled={busy || !client.testMcp}
            onClick={() => {
              setBusy(true);
              setMessage('正在连接服务器并读取能力目录…');
              void client
                .testMcp?.(server.id, server.revision)
                .then((result) =>
                  setMessage(
                    `连接成功 · 协议 ${result.protocol} · ${result.toolCount} 个兼容工具${result.rejectedTools ? ` · ${result.rejectedTools} 个不兼容工具` : ''}。未执行业务工具。`,
                  ),
                )
                .catch((e) => setMessage(errorText(e)))
                .finally(() => setBusy(false));
            }}
          >
            检查连接
          </button>
          {server.enabled && (
            <button
              className="text-button"
              onClick={() => {
                void client
                  .disableMcp?.(server.id, state.revision)
                  .then(reload)
                  .catch((e) => setMessage(errorText(e)));
              }}
            >
              停用
            </button>
          )}
        </article>
      ))}
      {editing && (
        <form
          className="settings-editor"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void client
              .saveMcp?.(
                {
                  id: crypto.randomUUID(),
                  namespace,
                  displayName: name,
                  revision: 1,
                  enabled: false,
                  protocol: 'auto',
                  transport: {
                    type: 'streamable-http',
                    endpoint,
                    allowPrivateDestination: privateHost,
                    auth: { type: 'none' },
                  },
                  capabilities: { tools: true, resources: true, prompts: true },
                },
                state!.revision,
                null,
              )
              .then(async () => {
                await reload();
                setEditing(false);
                setName('');
                setNamespace('');
                setEndpoint('');
                setMessage('连接已保存为未启用配置。');
              })
              .catch((e) => setMessage(errorText(e)))
              .finally(() => setBusy(false));
          }}
        >
          <div className="editor-heading">
            <h3>添加远程服务器</h3>
            <button type="button" className="text-button" onClick={() => setEditing(false)}>
              取消
            </button>
          </div>
          <div className="settings-fields">
            <label>
              名称
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="例如：文档服务"
              />
            </label>
            <label>
              命名空间
              <input
                value={namespace}
                onChange={(e) => setNamespace(e.target.value)}
                required
                pattern="[a-z][a-z0-9_\-]{0,31}"
                placeholder="例如：docs"
              />
            </label>
          </div>
          <label>
            服务器地址
            <input
              type="url"
              required
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://your-server.example/mcp"
            />
          </label>
          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={privateHost}
              onChange={(e) => setPrivateHost(e.target.checked)}
            />
            允许此固定地址位于本机或内网
          </label>
          <div className="settings-form-footer">
            <button type="button" className="secondary-button" onClick={() => setEditing(false)}>
              取消
            </button>
            <button className="primary-button compact" disabled={busy}>
              {busy ? '保存中…' : '保存连接'}
            </button>
          </div>
        </form>
      )}
      <Status message={message} />
      <div className="settings-info-note">
        <SettingsIcon name="info" />
        <p>
          保存配置不会连接服务器。检查连接会访问所配置的地址并读取能力目录，不执行业务工具。 Agent
          工具审批与执行接入仍在开发，配置保持停用。
        </p>
      </div>
    </>
  );
}
