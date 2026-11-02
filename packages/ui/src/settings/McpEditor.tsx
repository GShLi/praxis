import { useState } from 'react';

export function McpEditor({
  busy,
  save,
  cancel,
}: {
  busy: boolean;
  save(config: unknown): Promise<boolean>;
  cancel(): void;
}) {
  const [name, setName] = useState(''),
    [namespace, setNamespace] = useState('');
  const [endpoint, setEndpoint] = useState(''),
    [privateHost, setPrivateHost] = useState(false);
  const [resources, setResources] = useState(false);
  return (
    <form
      className="settings-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save({
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
          capabilities: { tools: true, resources, prompts: false },
        }).then((saved) => {
          if (saved) cancel();
        });
      }}
    >
      <div className="editor-heading">
        <h3>添加远程服务器</h3>
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
      <label className="settings-checkbox">
        <input
          type="checkbox"
          checked={resources}
          onChange={(e) => setResources(e.target.checked)}
        />
        允许 Agent 读取文本资源（每次读取需要确认）
      </label>
      <div className="settings-form-footer">
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
