import { useState } from 'react';
import type { McpState } from '../client-types.ts';

export function McpEditor({
  busy,
  save,
  cancel,
  initial,
}: {
  busy: boolean;
  save(config: unknown): Promise<boolean>;
  cancel(): void;
  initial?: McpState['value'][number];
}) {
  const [name, setName] = useState(initial?.displayName ?? ''),
    [namespace, setNamespace] = useState(initial?.namespace ?? '');
  const [endpoint, setEndpoint] = useState(initial?.transport.endpoint ?? ''),
    [privateHost, setPrivateHost] = useState(initial?.transport.allowPrivateDestination ?? false);
  const [resources, setResources] = useState(initial?.capabilities?.resources ?? false),
    [prompts, setPrompts] = useState(initial?.capabilities?.prompts ?? false);
  const [tools, setTools] = useState(initial?.capabilities?.tools ?? true),
    [protocol, setProtocol] = useState(initial?.protocol ?? 'auto');
  return (
    <form
      className="settings-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save({
          id: initial?.id ?? crypto.randomUUID(),
          namespace,
          displayName: name,
          revision: initial?.revision ?? 1,
          enabled: false,
          protocol,
          transport: {
            type: 'streamable-http',
            endpoint,
            allowPrivateDestination: privateHost,
            auth: { type: 'none' },
          },
          capabilities: { tools, resources, prompts },
        }).then((saved) => {
          if (saved) cancel();
        });
      }}
    >
      <div className="editor-heading">
        <h3>{initial ? '编辑远程服务器' : '添加远程服务器'}</h3>
        <button type="button" className="text-button" onClick={cancel}>
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
            disabled={Boolean(initial)}
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
      <label>
        协议版本
        <select value={protocol} onChange={(event) => setProtocol(event.target.value)}>
          <option value="auto">自动协商</option>
          <option value="2026-07-28">2026-07-28</option>
          <option value="2025-11-25">2025-11-25</option>
        </select>
      </label>
      <label className="settings-checkbox">
        <input
          type="checkbox"
          checked={tools}
          onChange={(event) => setTools(event.target.checked)}
        />
        允许 Agent 发现并调用工具（每次调用需要确认）
      </label>
      <label className="settings-checkbox">
        <input
          type="checkbox"
          checked={privateHost}
          onChange={(e) => setPrivateHost(e.target.checked)}
        />
        允许此固定地址位于本机或内网
      </label>
      <label className="settings-checkbox">
        <input
          type="checkbox"
          checked={resources}
          onChange={(e) => setResources(e.target.checked)}
        />
        允许 Agent 读取文本资源（每次读取需要确认）
      </label>
      <label className="settings-checkbox">
        <input
          type="checkbox"
          checked={prompts}
          onChange={(event) => setPrompts(event.target.checked)}
        />
        允许用户选择并预览提示词模板
      </label>
      <div className="settings-form-footer">
        {initial && <p>保存后需要重新检查并启用。更改服务器地址会清除旧地址的本地凭据。</p>}
        <button type="button" className="secondary-button" onClick={cancel}>
          取消
        </button>
        <button className="primary-button compact" disabled={busy}>
          {busy ? '保存中…' : '保存连接'}
        </button>
      </div>
    </form>
  );
}
