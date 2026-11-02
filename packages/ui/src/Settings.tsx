import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  ApiKeyInfo,
  McpState,
  PluginReview,
  PluginState,
  PraxisClient,
  Profile,
  Provider,
  Snapshot,
} from './client.ts';
import type { SettingsTab } from './Navigation.tsx';
import './settings.css';

const categories = [
  {
    id: 'general',
    title: '常规',
    description: '调整语言、默认模型与对话习惯。',
    group: '个人',
    icon: 'sliders',
  },
  {
    id: 'appearance',
    title: '外观',
    description: '调整主题与回答的文字大小。',
    group: '个人',
    icon: 'sun',
  },
  {
    id: 'models',
    title: '模型提供商',
    description: '管理模型与密钥，供 ChatBot 和 Agent 共同使用。',
    group: '个人',
    icon: 'model',
  },
  {
    id: 'agent',
    title: 'Agent 与工作区',
    description: '管理本地任务的文件权限与执行方式。',
    group: '本地能力',
    icon: 'terminal',
  },
  {
    id: 'mcp',
    title: 'MCP 连接',
    description: '连接外部工具、资源和提示词服务。',
    group: '本地能力',
    icon: 'connect',
  },
  {
    id: 'plugins',
    title: '插件',
    description: '使用可信的本地插件扩展知行。',
    group: '本地能力',
    icon: 'plugin',
  },
  {
    id: 'data',
    title: '数据与隐私',
    description: '了解数据的保存位置，导出当前会话。',
    group: '个人',
    icon: 'data',
  },
  {
    id: 'account',
    title: '账户与安全',
    description: '查看登录身份，管理客户端访问。',
    group: '个人',
    icon: 'person',
  },
  {
    id: 'about',
    title: '关于知行',
    description: '版本信息与当前客户端状态。',
    group: '个人',
    icon: 'info',
  },
] as const;
function SettingsIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    sliders: 'M4 7h5m4 0h7M4 17h9m4 0h3M9 4v6m4 4v6',
    model: 'm12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 9 8-4.5M12 12 4 7.5M12 12v9',
    terminal: 'M4 5h16v14H4zM7 9l3 3-3 3m6 0h4',
    connect:
      'm9 15 6-6M7 14l-1 1a3.5 3.5 0 0 0 5 5l4-4a3.5 3.5 0 0 0 0-5m2-1 1-1a3.5 3.5 0 0 0-5-5l-4 4a3.5 3.5 0 0 0 0 5',
    plugin: 'M9 4h6v4h5v6h-5v6H9v-6H4V8h5V4Z',
    data: 'M5 6c0-4 14-4 14 0S5 10 5 6Zm0 0v12c0 4 14 4 14 0V6M5 12c0 4 14 4 14 0',
    person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 21v-2a7 7 0 0 1 14 0v2',
    info: 'M12 8h.01M12 11v6M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    back: 'm10 5-7 7 7 7M3 12h18',
    search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm5-1 5 5',
    plus: 'M12 5v14M5 12h14',
    arrow: 'm9 5 7 7-7 7',
    check: 'm5 12 4 4 10-10',
    sun: 'M12 3v2m0 14v2M3 12h2m14 0h2M6 6l1 1m10 10 1 1M6 18l1-1M17 7l1-1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  };
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.info} />
    </svg>
  );
}
function Row({
  title,
  description,
  children,
}: {
  title: string;
  description?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div className="setting-row-label">
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      <div className="setting-row-control">{children}</div>
    </div>
  );
}
function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="settings-empty">
      <span className="settings-empty-icon">
        <SettingsIcon name={icon} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function Status({ message }: { message: string }) {
  return message ? (
    <p className="settings-feedback" role="status">
      {message}
    </p>
  ) : null;
}
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '操作失败，请重试。';
function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="secondary-button"
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
    >
      {copied ? '已复制' : '复制'}
    </button>
  );
}
export function Settings({
  tab: requestedTab,
  navigate,
  client,
  providers,
  saved,
  close,
  logout,
  snapshot,
}: {
  tab: SettingsTab;
  navigate: (tab: SettingsTab) => void;
  client: PraxisClient;
  providers: Provider[];
  saved: () => Promise<void>;
  close: () => void;
  logout: () => Promise<void>;
  snapshot: Snapshot | null;
}) {
  const tab =
    !client.desktop && ['agent', 'mcp', 'plugins'].includes(requestedTab)
      ? 'general'
      : requestedTab;
  const [search, setSearch] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null),
    [profileError, setProfileError] = useState('');
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    void client
      .profile?.()
      .then(setProfile)
      .catch((e) => setProfileError(errorText(e)));
  }, [client]);
  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
  }, [tab]);
  const visible = categories.filter(
    (item) =>
      (client.desktop || !['agent', 'mcp', 'plugins'].includes(item.id)) &&
      `${item.title} ${item.description}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const current = categories.find((item) => item.id === tab)!;
  return (
    <div className="settings-page">
      <div className="settings-layout">
        <aside className="settings-nav">
          <div className="settings-nav-heading">
            <h1>设置</h1>
            <button className="icon-button" aria-label="返回对话" title="返回对话" onClick={close}>
              <SettingsIcon name="back" />
            </button>
          </div>
          <div className="settings-search">
            <SettingsIcon name="search" />
            <input
              aria-label="搜索设置分类"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索"
            />
          </div>
          <nav aria-label="设置分类">
            {['个人', '本地能力'].map((group) => {
              const items = visible.filter((item) => item.group === group);
              if (!items.length) return null;
              return (
                <section key={group}>
                  <h2>{group}</h2>
                  {items.map((item) => (
                    <button
                      key={item.id}
                      className={tab === item.id ? 'selected' : ''}
                      aria-current={tab === item.id ? 'page' : undefined}
                      onClick={() => navigate(item.id)}
                    >
                      <SettingsIcon name={item.icon} />
                      <span>{item.title}</span>
                    </button>
                  ))}
                </section>
              );
            })}
            {!visible.length && <p className="settings-no-results">没有匹配的设置分类</p>}
          </nav>
        </aside>
        <main className="settings-main" ref={main}>
          <div className="settings-main-inner">
            <div className="settings-page-heading">
              <h2>{current.title}</h2>
            </div>
            {tab === 'general' && <General providers={providers} />}
            {tab === 'appearance' && <Appearance />}
            {tab === 'models' && <Models client={client} providers={providers} saved={saved} />}
            {tab === 'agent' && <AgentSettings client={client} snapshot={snapshot} />}
            {tab === 'mcp' && <McpSettings client={client} />}
            {tab === 'plugins' && <PluginSettings client={client} />}
            {tab === 'data' && <DataSettings client={client} snapshot={snapshot} />}
            {tab === 'account' && (
              <Account
                client={client}
                profile={profile}
                profileError={profileError}
                logout={logout}
              />
            )}
            {tab === 'about' && <About client={client} />}
          </div>
        </main>
      </div>
    </div>
  );
}
function Appearance() {
  const [theme, setTheme] = useState(localStorage.getItem('praxis-theme') ?? 'system');
  const [font, setFont] = useState(localStorage.getItem('praxis-font') ?? '16');
  return (
    <>
      <section className="settings-section">
        <h2>视觉样式</h2>
        <div className="settings-group">
          <Row title="模式">
            <div className="theme-segments" role="group" aria-label="主题模式">
              {(['system', 'light', 'dark'] as const).map((value) => (
                <button
                  key={value}
                  aria-pressed={theme === value}
                  className={theme === value ? 'selected' : ''}
                  onClick={() => {
                    setTheme(value);
                    document.documentElement.dataset.theme = value;
                    localStorage.setItem('praxis-theme', value);
                  }}
                >
                  {value === 'system' ? '系统' : value === 'light' ? '浅色' : '深色'}
                </button>
              ))}
            </div>
          </Row>
        </div>
      </section>
      <section className="settings-section">
        <h2>文字</h2>
        <div className="settings-group">
          <Row title="回答字号" description="调整对话内容的文字大小。">
            <select
              aria-label="回答字号"
              value={font}
              onChange={(e) => {
                setFont(e.target.value);
                localStorage.setItem('praxis-font', e.target.value);
                document.documentElement.style.setProperty('--message-font', `${e.target.value}px`);
              }}
            >
              <option value="14">紧凑 · 14</option>
              <option value="16">标准 · 16</option>
              <option value="18">舒适 · 18</option>
            </select>
          </Row>
        </div>
        <div className="appearance-preview" aria-label="回答样式预览">
          <span>预览</span>
          <p>我能帮你做些什么？</p>
          <div>一起梳理思路，理解问题，完成你的下一个想法。</div>
        </div>
      </section>
      <p className="settings-footnote">外观自动保存在当前客户端。</p>
    </>
  );
}
function General({ providers }: { providers: Provider[] }) {
  const [sendMode, setSendMode] = useState(localStorage.getItem('praxis-send-mode') ?? 'enter');
  const [model, setModel] = useState(localStorage.getItem('praxis-default-provider') ?? '');
  return (
    <>
      <section className="settings-section">
        <h2>常规</h2>
        <div className="settings-group">
          <Row title="语言">
            <span className="setting-value">简体中文</span>
          </Row>
          <Row title="默认模型" description="开始新对话时优先选择此配置。">
            <select
              aria-label="默认模型"
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                localStorage.setItem('praxis-default-provider', e.target.value);
              }}
            >
              <option value="">首个可用模型</option>
              {providers
                .filter((p) => p.enabled)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </Row>
        </div>
      </section>
      <section className="settings-section">
        <h2>对话</h2>
        <div className="settings-group">
          <Row title="发送消息" description="使用 Shift + Enter 始终可以换行。">
            <select
              aria-label="发送消息快捷键"
              value={sendMode}
              onChange={(e) => {
                setSendMode(e.target.value);
                localStorage.setItem('praxis-send-mode', e.target.value);
              }}
            >
              <option value="enter">Enter 发送</option>
              <option value="modifier">⌘ / Ctrl + Enter 发送</option>
            </select>
          </Row>
        </div>
      </section>
      <p className="settings-footnote">操作偏好自动保存在当前客户端。</p>
    </>
  );
}
function Models({
  client,
  providers,
  saved,
}: {
  client: PraxisClient;
  providers: Provider[];
  saved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null),
    [confirm, setConfirm] = useState<string | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const selected = providers.find((p) => p.id === editing);
  return (
    <>
      <div className="settings-section-toolbar">
        <span>{providers.length} 个模型配置</span>
        <button
          className="primary-button compact"
          onClick={() => {
            setEditing('new');
            setMessage('');
          }}
        >
          <SettingsIcon name="plus" />
          添加提供商
        </button>
      </div>
      {!providers.length && editing === null && (
        <Empty icon="model" title="添加你的第一个模型">
          填写模型提供商与 API Key 后，即可开始对话。
        </Empty>
      )}
      <div className="provider-list">
        {providers.map((p) => (
          <article className={`provider-row ${editing === p.id ? 'editing' : ''}`} key={p.id}>
            <span className="provider-symbol">D</span>
            <div className="provider-summary">
              <h3>
                {p.name}
                <span className={`settings-badge ${p.enabled ? 'available' : ''}`}>
                  {p.enabled ? '已启用' : '已停用'}
                </span>
              </h3>
              <p>
                {p.model} <span>·</span> {p.keyConfigured ? 'Key 已配置' : '未配置 Key'}
              </p>
            </div>
            <button
              className="secondary-button"
              onClick={() => {
                setEditing(p.id);
                setMessage('');
              }}
            >
              管理
            </button>
          </article>
        ))}
      </div>
      {editing !== null && (
        <ProviderEditor
          key={editing}
          provider={selected}
          client={client}
          close={() => setEditing(null)}
          saved={async () => {
            await saved();
            setEditing(null);
            setMessage('模型配置已保存。');
          }}
        />
      )}
      {selected && client.deleteProvider && (
        <div className="settings-delete-row">
          {confirm === selected.id ? (
            <>
              <p>删除“{selected.name}”及其保存的 Key？已有会话历史会保留。</p>
              <button
                className="secondary-button danger"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void client.deleteProvider!(selected.id, selected.revision)
                    .then(async () => {
                      await saved();
                      setEditing(null);
                      setConfirm(null);
                      setMessage('模型配置已删除。');
                    })
                    .catch((e) => setMessage(errorText(e)))
                    .finally(() => setBusy(false));
                }}
              >
                确认删除
              </button>
              <button className="text-button" onClick={() => setConfirm(null)}>
                取消
              </button>
            </>
          ) : (
            <button className="text-button danger" onClick={() => setConfirm(selected.id)}>
              删除此模型配置
            </button>
          )}
        </div>
      )}
      <Status message={message} />
      <div className="settings-info-note">
        <SettingsIcon name="info" />
        <p>
          ChatBot 与 Agent 共用同一份配置。
          {client.desktop
            ? '本地任务从 Praxis 获取配置后，直接请求模型厂商。'
            : 'Web 对话由 Praxis 服务端调用模型，厂商 Key 不会返回浏览器。'}
        </p>
      </div>
    </>
  );
}
function ProviderEditor({
  provider,
  client,
  close,
  saved,
}: {
  provider: Provider | undefined;
  client: PraxisClient;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [name, setName] = useState(provider?.name ?? 'DeepSeek'),
    [model, setModel] = useState(provider?.model ?? 'deepseek-flash'),
    [key, setKey] = useState('');
  const [windowSize, setWindowSize] = useState(provider?.contextWindow ?? 128000),
    [output, setOutput] = useState(provider?.maxOutputTokens ?? 4096),
    [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <form
      className="settings-editor"
      onSubmit={(e) => {
        e.preventDefault();
        setError('');
        if (output >= windowSize / 2) {
          setError('最大输出必须小于上下文窗口的一半。');
          return;
        }
        setBusy(true);
        void client
          .saveProvider({
            config: {
              name,
              model,
              baseUrl: 'https://api.deepseek.com',
              contextWindow: windowSize,
              maxOutputTokens: output,
              enabled,
            },
            ...(key ? { apiKey: key } : {}),
            ...(provider ? { id: provider.id, expectedRevision: provider.revision } : {}),
          })
          .then(async () => {
            setKey('');
            await saved();
          })
          .catch((e) => setError(errorText(e)))
          .finally(() => setBusy(false));
      }}
    >
      <div className="editor-heading">
        <h3>{provider ? '编辑模型配置' : '添加模型提供商'}</h3>
        <button type="button" className="text-button" onClick={close}>
          取消
        </button>
      </div>
      <div className="settings-fields">
        <label>
          提供商
          <input value="DeepSeek" readOnly />
        </label>
        <label>
          显示名称
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
        </label>
        <label>
          模型 ID
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            required
            maxLength={128}
          />
        </label>
        <label>
          API 地址
          <input value="https://api.deepseek.com" readOnly />
        </label>
      </div>
      <label>
        API Key
        <input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          required={!provider}
          placeholder={provider ? '已保存；留空保持原 Key' : '输入模型厂商 API Key'}
        />
      </label>
      <p className="field-help">密钥只用于模型请求，保存后不再显示原值。</p>
      <div className="settings-fields">
        <label>
          上下文窗口
          <input
            type="number"
            min={8192}
            max={2000000}
            value={windowSize}
            onChange={(e) => setWindowSize(Number(e.target.value))}
            required
          />
        </label>
        <label>
          最大输出 Tokens
          <input
            type="number"
            min={256}
            max={393216}
            value={output}
            onChange={(e) => setOutput(Number(e.target.value))}
            required
          />
        </label>
      </div>
      <p className="field-help">容量请以模型厂商公布的信息为准。</p>
      <label className="settings-checkbox">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        启用此模型配置
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="settings-form-footer">
        <button type="button" className="secondary-button" onClick={close}>
          取消
        </button>
        <button className="primary-button compact" disabled={busy}>
          {busy ? '正在保存…' : '保存配置'}
        </button>
      </div>
    </form>
  );
}
function AgentSettings({ client, snapshot }: { client: PraxisClient; snapshot: Snapshot | null }) {
  const [mode, setMode] = useState(
      localStorage.getItem('praxis-default-permission') ?? 'workspace-write',
    ),
    [message, setMessage] = useState('');
  return (
    <>
      <section className="settings-section">
        <h2>文件权限</h2>
        <div className="settings-group">
          <Row title="新任务的默认权限" description="只影响此客户端之后创建的 Agent 会话。">
            <select
              aria-label="新任务默认权限"
              value={mode}
              onChange={(e) => {
                setMode(e.target.value);
                localStorage.setItem('praxis-default-permission', e.target.value);
              }}
            >
              <option value="workspace-write">工作区可写</option>
              <option value="read-only">只读</option>
            </select>
          </Row>
          {snapshot?.session.kind === 'agent' && (
            <Row title="当前任务权限" description={snapshot.session.workspace}>
              <select
                aria-label="当前任务权限"
                value={snapshot.session.permissionMode ?? 'workspace-write'}
                onChange={(e) => {
                  void client
                    .setPermissions?.(
                      snapshot.session.id,
                      snapshot.session.permissionRevision ?? 0,
                      e.target.value as 'read-only' | 'workspace-write',
                    )
                    .then(() => setMessage('当前任务权限已更新。'))
                    .catch((error) => setMessage(errorText(error)));
                }}
              >
                <option value="workspace-write">工作区可写</option>
                <option value="read-only">只读</option>
              </select>
            </Row>
          )}
          <Row title="内部数据保护" description="应用凭据、会话存储和受保护目录不向文件工具开放。">
            <span className="settings-badge available">始终启用</span>
          </Row>
        </div>
      </section>
      <section className="settings-section">
        <h2>任务生命周期</h2>
        <div className="settings-group">
          <Row title="关闭应用时" description="停止当前客户端的任务，保留已经保存的历史记录。">
            <span className="setting-value">停止执行</span>
          </Row>
          <Row title="再次打开时" description="由你发送新的要求后继续，历史工具调用不会自动重跑。">
            <span className="setting-value">手动继续</span>
          </Row>
        </div>
      </section>
      <Status message={message} />
      <div className="settings-info-note">
        <SettingsIcon name="terminal" />
        <p>命令执行需通过对应系统的沙箱检查。当前版本尚未开放命令后端，文件工具可以独立使用。</p>
      </div>
    </>
  );
}
function McpSettings({ client }: { client: PraxisClient }) {
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
function PluginSettings({ client }: { client: PraxisClient }) {
  const [state, setState] = useState<PluginState | null>(null),
    [source, setSource] = useState(''),
    [review, setReview] = useState<PluginReview | null>(null),
    [adding, setAdding] = useState(false),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const reload = async () => {
    if (client.plugins) setState(await client.plugins());
  };
  useEffect(() => {
    void reload().catch((e) => setMessage(errorText(e)));
  }, [client]);
  return (
    <>
      <div className="settings-section-toolbar">
        <span>{state ? `${state.value.length} 个已安装插件` : '正在读取插件…'}</span>
        <button
          className="primary-button compact"
          onClick={() => setAdding(true)}
          disabled={!client.inspectPlugin}
        >
          <SettingsIcon name="plus" />
          安装本地插件
        </button>
      </div>
      {state?.restartRequired && (
        <div className="settings-info-note">
          <SettingsIcon name="info" />
          <p>插件配置已变化。请重新登录或重启客户端，之后开始的新任务会使用新配置。</p>
        </div>
      )}
      {state?.value.length === 0 && !adding && (
        <Empty icon="plugin" title="按需要扩展知行">
          安装已构建的可信插件，添加工具、命令或模型适配器。
        </Empty>
      )}
      {state?.value.map((plugin) => (
        <article className="provider-row" key={plugin.manifest.id}>
          <span className="connection-symbol">
            <SettingsIcon name="plugin" />
          </span>
          <div className="provider-summary">
            <h3>
              {plugin.manifest.id}
              <span className="settings-badge">{plugin.enabled ? '已启用' : '已停用'}</span>
            </h3>
            <p>
              v{plugin.manifest.version} · {plugin.manifest.capabilities.join(' · ')}
            </p>
          </div>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void client
                .enablePlugin?.(plugin.manifest.id, !plugin.enabled, state.revision)
                .then(reload)
                .catch((e) => setMessage(errorText(e)))
                .finally(() => setBusy(false));
            }}
          >
            {plugin.enabled ? '停用' : '启用'}
          </button>
        </article>
      ))}
      {state?.failures?.map((failure) => (
        <p className="form-error" key={`${failure.id}:${failure.mode}`}>
          {failure.id} · {failure.mode} · {failure.code}
        </p>
      ))}
      {adding && (
        <form
          className="settings-editor"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setMessage('');
            void client
              .inspectPlugin?.(source)
              .then(setReview)
              .catch((error) => setMessage(errorText(error)))
              .finally(() => setBusy(false));
          }}
        >
          <div className="editor-heading">
            <h3>检查插件包</h3>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setAdding(false);
                setReview(null);
              }}
            >
              取消
            </button>
          </div>
          <label>
            已构建插件的目录
            <input
              value={source}
              required
              onChange={(e) => {
                setSource(e.target.value);
                setReview(null);
              }}
              placeholder="/path/to/your-plugin"
            />
          </label>
          <p className="field-help">目录中需包含 praxis-plugin.json，不会自动安装包内依赖。</p>
          <button className="secondary-button" disabled={busy}>
            {busy ? '正在检查…' : '检查包内容'}
          </button>
          {review && (
            <div className="plugin-review">
              <h4>
                {review.manifest.id} <span>v{review.manifest.version}</span>
              </h4>
              <p>{review.warning}</p>
              <dl>
                <dt>声明能力</dt>
                <dd>{review.manifest.capabilities.join(' · ')}</dd>
                <dt>包大小</dt>
                <dd>{(review.bytes / 1024).toFixed(1)} KiB</dd>
                <dt>内容摘要</dt>
                <dd className="settings-hash">{review.digest}</dd>
              </dl>
              <button
                type="button"
                className="primary-button compact"
                disabled={busy || !state}
                onClick={() => {
                  setBusy(true);
                  void client
                    .installPlugin?.(source, review.digest, state!.revision)
                    .then(async () => {
                      await reload();
                      setReview(null);
                      setAdding(false);
                      setMessage('插件已安装，默认停用。核对后可启用。');
                    })
                    .catch((error) => setMessage(errorText(error)))
                    .finally(() => setBusy(false));
                }}
              >
                信任此来源并安装
              </button>
            </div>
          )}
        </form>
      )}
      <Status message={message} />
      <p className="settings-footnote">
        插件运行在 Host 权限内。仅安装你信任的代码；模型不能安装或启用插件。
      </p>
    </>
  );
}
function DataSettings({ client, snapshot }: { client: PraxisClient; snapshot: Snapshot | null }) {
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  async function exportCurrent() {
    if (!snapshot) return;
    setBusy(true);
    try {
      const data = await client.read(snapshot.session.id);
      const blob = new Blob(
        [
          JSON.stringify(
            {
              format: 'praxis-visible-conversation-v1',
              exportedAt: new Date().toISOString(),
              ...data,
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      );
      const url = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = url;
      a.download = `praxis-${snapshot.session.id}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setMessage('当前可见会话已导出。');
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="settings-section">
        <h2>会话数据</h2>
        <div className="settings-group">
          <Row
            title="历史记录保存位置"
            description={
              client.desktop
                ? '此桌面客户端的会话保存在本机，和 CLI 的会话分别管理。'
                : 'Web 对话保存在你的 Praxis 服务端，按登录账号隔离。'
            }
          >
            <span className="setting-value">{client.desktop ? '本机' : 'Praxis 服务端'}</span>
          </Row>
          <Row
            title="当前会话导出"
            description={
              snapshot
                ? `导出“${snapshot.session.title}”的可见消息与状态，格式为 JSON。`
                : '打开一个会话后，可以导出其中的可见消息与状态。'
            }
          >
            <button
              className="secondary-button"
              disabled={!snapshot || busy}
              onClick={() => {
                void exportCurrent();
              }}
            >
              {busy ? '正在导出…' : '导出会话'}
            </button>
          </Row>
        </div>
      </section>
      <section className="settings-section">
        <h2>模型与隐私</h2>
        <div className="settings-group">
          <Row
            title="发送给模型的内容"
            description="回答所需的消息与上下文会发送给你选择的模型提供商。"
          >
            <span className="setting-value">按请求发送</span>
          </Row>
          <Row
            title="上下文压缩"
            description="摘要用于之后的模型请求。已经保存的原始历史不会因为压缩而覆盖。"
          >
            <span className="setting-value">保留历史</span>
          </Row>
          <Row title="默认遥测上传" description="本地 Session 不会自动上传为服务端任务记录。">
            <span className="setting-value">未启用</span>
          </Row>
        </div>
      </section>
      <Status message={message} />
    </>
  );
}
function Account({
  client,
  profile,
  profileError,
  logout,
}: {
  client: PraxisClient;
  profile: Profile | null;
  profileError: string;
  logout: () => Promise<void>;
}) {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]),
    [secret, setSecret] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<string | null>(null);
  const reload = async () => {
    if (client.keys) setKeys(await client.keys());
  };
  useEffect(() => {
    void reload().catch((e) => setMessage(errorText(e)));
  }, [client]);
  return (
    <>
      <section className="settings-account-card">
        <span className="settings-large-avatar">
          {profile?.username.slice(0, 1).toUpperCase() || '知'}
        </span>
        <div>
          <h3>{profile?.username || '已登录 Praxis'}</h3>
          <p>个人账户 · {client.desktop ? '客户端连接' : 'Web 会话'}</p>
        </div>
      </section>
      <Status message={profileError} />
      <section className="settings-section">
        <h2>登录信息</h2>
        <div className="settings-group">
          <Row title="登录方式">
            <span className="setting-value">
              {client.desktop ? 'Praxis API Key' : '账号与密码'}
            </span>
          </Row>
          {profile && (
            <Row title="账户 ID">
              <code className="settings-account-id">{profile.id}</code>
            </Row>
          )}
          <Row title="退出当前客户端" description="退出前会停止当前客户端的任务。">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void logout()
                  .catch((e) => setMessage(errorText(e)))
                  .finally(() => setBusy(false));
              }}
            >
              退出登录
            </button>
          </Row>
        </div>
      </section>
      {client.createKey && (
        <section className="settings-section">
          <div className="settings-section-toolbar">
            <div>
              <h2>客户端访问密钥</h2>
              <p>用 Praxis API Key 登录桌面端和 CLI。</p>
            </div>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void client.createKey!()
                  .then(async (value) => {
                    setSecret(value);
                    await reload();
                  })
                  .catch((e) => setMessage(errorText(e)))
                  .finally(() => setBusy(false));
              }}
            >
              <SettingsIcon name="plus" />
              创建 Key
            </button>
          </div>
          {secret && (
            <div className="settings-secret">
              <h3>请保存这个 Key</h3>
              <p>仅显示本次，离开此分类后将不再显示。</p>
              <code>{secret}</code>
              <div>
                <CopyValue value={secret} />
                <button className="text-button" onClick={() => setSecret('')}>
                  我已保存
                </button>
              </div>
            </div>
          )}
          {keys.length === 0 && <p className="settings-footnote">还没有为客户端创建访问密钥。</p>}
          {keys.map((key) => (
            <div className="api-key-row" key={key.id}>
              <div>
                <h3>
                  {key.name}
                  <span className="settings-badge">
                    {key.revoked_at
                      ? '已撤销'
                      : new Date(key.expires_at).getTime() < Date.now()
                        ? '已过期'
                        : '有效'}
                  </span>
                </h3>
                <p>
                  到期 {new Date(key.expires_at).toLocaleDateString('zh-CN')} ·{' '}
                  {key.last_used_at
                    ? `最近使用 ${new Date(key.last_used_at).toLocaleDateString('zh-CN')}`
                    : '尚未使用'}
                </p>
              </div>
              {!key.revoked_at &&
                (confirm === key.id ? (
                  <div className="inline-actions">
                    <button
                      className="secondary-button danger"
                      disabled={busy}
                      onClick={() => {
                        setBusy(true);
                        void client
                          .revokeKey?.(key.id)
                          .then(async () => {
                            await reload();
                            setConfirm(null);
                            setMessage('Key 已撤销；已签发的短期访问凭据会在到期后失效。');
                          })
                          .catch((e) => setMessage(errorText(e)))
                          .finally(() => setBusy(false));
                      }}
                    >
                      确认撤销
                    </button>
                    <button className="text-button" onClick={() => setConfirm(null)}>
                      取消
                    </button>
                  </div>
                ) : (
                  <button className="text-button danger" onClick={() => setConfirm(key.id)}>
                    撤销
                  </button>
                ))}
            </div>
          ))}
        </section>
      )}
      <Status message={message} />
    </>
  );
}
function About({ client }: { client: PraxisClient }) {
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null),
    [message, setMessage] = useState('');
  useEffect(() => {
    void client
      .diagnostics?.()
      .then(setDiagnostics)
      .catch((e) => setMessage(errorText(e)));
  }, [client]);
  return (
    <>
      <div className="settings-about">
        <span className="brand-mark">知</span>
        <h3>知行 Praxis</h3>
        <p>From thought to action.</p>
      </div>
      <section className="settings-section">
        <Row title="应用版本">
          <span className="setting-value">0.1.0 · 开发版本</span>
        </Row>
        <Row title="当前客户端">
          <span className="setting-value">
            {client.desktop ? '桌面端 · ChatBot + Agent' : 'Web · ChatBot'}
          </span>
        </Row>
        {diagnostics && (
          <>
            <Row title="运行系统">
              <span className="setting-value">
                {String(diagnostics.platform)} · {String(diagnostics.arch)}
              </span>
            </Row>
            <Row title="Node.js">
              <span className="setting-value">{String(diagnostics.node)}</span>
            </Row>
            <details className="settings-diagnostics">
              <summary>查看诊断信息</summary>
              <pre>{JSON.stringify(diagnostics, null, 2)}</pre>
              <CopyValue value={JSON.stringify(diagnostics, null, 2)} />
            </details>
          </>
        )}
      </section>
      <Status message={message} />
    </>
  );
}
