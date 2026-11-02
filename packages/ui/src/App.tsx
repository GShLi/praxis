import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Event, ToolResult } from '../../contracts/src/index.ts';
import { Settings } from './Settings.tsx';
import { LocalClient, WebClient } from './client.ts';
import type { PraxisClient, Provider, Snapshot, ViewSession } from './client.ts';
import './styles.css';

function Icon({
  name,
}: {
  name: 'plus' | 'send' | 'stop' | 'menu' | 'settings' | 'close' | 'folder' | 'panel' | 'check';
}) {
  const paths = {
    plus: 'M12 5v14M5 12h14',
    send: 'M12 19V5m-6 6 6-6 6 6',
    stop: 'M7 7h10v10H7z',
    menu: 'M5 6h14M5 12h14M5 18h14',
    settings:
      'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4',
    close: 'm6 6 12 12M6 18 18 6',
    folder: 'M3 7h7l2-3h9v15H3z',
    panel: 'M3 4h18v16H3zM15 4v16',
    check: 'm5 12 4 4 10-10',
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
      <path d={paths[name]} />
    </svg>
  );
}
function Copy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="text-button"
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => setCopied(false));
      }}
    >
      {copied ? '已复制' : '复制'}
    </button>
  );
}
function MarkdownView({ content }: { content: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      components={{
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
        pre: ({ children }) => (
          <div className="code-block">
            <div className="code-header">
              <span>代码</span>
              <Copy text={extractText(children)} />
            </div>
            <pre>{children}</pre>
          </div>
        ),
      }}
    >
      {content}
    </Markdown>
  );
}
function extractText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (node && typeof node === 'object' && 'props' in node)
    return extractText((node.props as { children?: ReactNode }).children);
  return '';
}
const statusText: Record<string, string> = {
  idle: '就绪',
  running: '正在执行',
  waiting_input: '等待你的回答',
  waiting_approval: '等待批准',
  cancelling: '正在停止',
  completed: '已完成',
  failed: '执行失败',
  interrupted: '已中断',
  cancelled: '已停止',
};
type Question = {
  questionId: string;
  turnId: string;
  questions: Array<{ id: string; prompt: string; options?: Array<{ id: string; label: string }> }>;
};
function ToolCard({ content, showChange }: { content: string; showChange: (id: string) => void }) {
  let result: ToolResult;
  try {
    result = JSON.parse(content) as ToolResult;
  } catch {
    return (
      <details className="tool">
        <summary>工具结果</summary>
        <pre>{content}</pre>
      </details>
    );
  }
  const data = result.data as
    | { path?: string; diffArtifactId?: string; processState?: string; preview?: string }
    | undefined;
  return (
    <details
      className={`tool ${result.status === 'failed' || result.status === 'denied' ? 'tool-error' : ''}`}
    >
      <summary>
        <span className="tool-dot" />
        <span>{result.toolId ?? '工具'}</span>
        <span className="tool-target">{data?.path?.split(/[\\/]/).at(-1) ?? ''}</span>
        <span className="tool-status">{data?.processState ?? result.status}</span>
      </summary>
      <div className="tool-body">
        {result.error && (
          <p>
            {result.error.code} · {result.error.message}
          </p>
        )}
        <pre>{JSON.stringify(result.data, null, 2)}</pre>
        {data?.diffArtifactId && (
          <button className="text-button" onClick={() => showChange(data.diffArtifactId!)}>
            查看文件变更
          </button>
        )}
      </div>
    </details>
  );
}
export function App({ client: injected }: { client?: PraxisClient }) {
  const [client] = useState<PraxisClient>(
    () => injected ?? (window.praxis ? new LocalClient(window.praxis) : new WebClient()),
  );
  const [authenticated, setAuthenticated] = useState(false),
    [checking, setChecking] = useState(true);
  const [sessions, setSessions] = useState<ViewSession[]>([]),
    [providers, setProviders] = useState<Provider[]>([]),
    [providerId, setProviderId] = useState('');
  const [kind, setKind] = useState<'chat' | 'agent'>('chat'),
    [selected, setSelected] = useState<string | null>(null),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState(''),
    [partial, setPartial] = useState(''),
    [sending, setSending] = useState(false),
    [error, setError] = useState('');
  const [settings, setSettings] = useState(false),
    [sidebar, setSidebar] = useState(() => window.innerWidth > 760),
    [panel, setPanel] = useState(false),
    [workspace, setWorkspace] = useState('');
  const [question, setQuestion] = useState<Question | null>(null),
    [change, setChange] = useState<{ path: string; before: string | null; after: string } | null>(
      null,
    );
  const [inputMode, setInputMode] = useState<'queue' | 'steer'>('queue'),
    [follow, setFollow] = useState(true);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const scroll = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null);
  const request = useRef(0);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : '操作失败，请重试。');
  const reloadLists = async () => {
    const [all, models] = await Promise.all([client.list(), client.providers()]);
    setSessions(all);
    setProviders(models);
    setProviderId((previous) =>
      models.some((p) => p.id === previous && p.enabled)
        ? previous
        : (models.find((p) => p.enabled && p.id === localStorage.getItem('praxis-default-provider'))
            ?.id ??
          models.find((p) => p.enabled)?.id ??
          ''),
    );
  };
  useEffect(() => {
    void client
      .current()
      .then(async (ok) => {
        setAuthenticated(ok);
        if (ok) await reloadLists();
      })
      .catch(fail)
      .finally(() => setChecking(false));
  }, [client]);
  useEffect(() => {
    if (!selected || !authenticated) {
      setSnapshot(null);
      setPartial('');
      setQuestion(null);
      return;
    }
    let stopped = false,
      off: (() => void) | undefined;
    let cursor = 0;
    const refresh = async () => {
      const order = ++request.current;
      const value = await client.read(selected);
      if (!stopped && selectedRef.current === selected && order === request.current)
        setSnapshot(value);
    };
    setPartial('');
    setQuestion(null);
    setChange(null);
    void client
      .read(selected)
      .then((value) => {
        if (stopped) return;
        setSnapshot(value);
        setQuestion(value.question ?? null);
        setKind(value.session.kind);
        cursor = value.throughSeq;
        off = client.listen(
          selected,
          cursor,
          (event: Event) => {
            if (stopped || event.seq <= cursor) return;
            if (event.seq !== cursor + 1) {
              void refresh().catch(fail);
            }
            cursor = event.seq;
            if (event.type === 'question/asked') setQuestion(event.payload as Question);
            if (event.type === 'question/answered' || event.type === 'turn/finished')
              setQuestion(null);
            if (event.type.endsWith('/error'))
              setError(String(event.payload.safeMessage ?? '执行失败。'));
            if (['assistant/message', 'generation/finished', 'turn/finished'].includes(event.type))
              setPartial('');
            if (
              event.type.endsWith('/message') ||
              event.type.endsWith('/accepted') ||
              event.type.endsWith('/finished') ||
              event.type.endsWith('/started') ||
              event.type.startsWith('question/') ||
              event.type === 'permission/changed'
            )
              void refresh().catch(fail);
            if (event.type.endsWith('/finished')) void reloadLists().catch(fail);
          },
          (text) => {
            if (!stopped) setPartial((current) => current + text);
          },
          fail,
        );
      })
      .catch(fail);
    return () => {
      stopped = true;
      off?.();
    };
  }, [selected, authenticated, client]);
  useEffect(() => {
    if (follow) scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'auto' });
  }, [snapshot?.messages.length, partial, follow, question]);
  const running = Boolean(
    snapshot &&
      ['running', 'waiting_input', 'waiting_approval', 'cancelling'].includes(
        snapshot.session.status,
      ),
  );
  const newSession = () => {
    setSelected(null);
    const preferred = localStorage.getItem('praxis-default-provider');
    if (providers.some((p) => p.id === preferred && p.enabled)) setProviderId(preferred!);
    setDraft('');
    setPartial('');
    setError('');
    setChange(null);
    input.current?.focus();
  };
  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!draft.trim() || sending) return;
    if (!providerId) {
      setSettings(true);
      setError('请先配置模型提供商。');
      return;
    }
    if (kind === 'agent' && !selected && !workspace) {
      setError('请先选择任务工作区。');
      return;
    }
    const text = draft.trim();
    setSending(true);
    setError('');
    try {
      let id = selected;
      if (!id) {
        const created = await client.create(kind, workspace || undefined);
        id = created.id;
        setSelected(id);
      }
      await client.send(id, text, providerId, inputMode, snapshot?.turnId ?? null);
      setDraft('');
      setFollow(true);
      await reloadLists();
    } catch (e) {
      fail(e);
    } finally {
      setSending(false);
      input.current?.focus();
    }
  }
  const showChange = async (id: string) => {
    if (!selected || !client.readArtifact) return;
    try {
      const value = await client.readArtifact(selected, id);
      if (value.kind === 'file-change') {
        setChange(JSON.parse(value.content) as typeof change);
        setPanel(true);
      }
    } catch (e) {
      fail(e);
    }
  };
  if (checking)
    return (
      <main className="loading" aria-live="polite">
        正在连接 Praxis…
      </main>
    );
  if (!authenticated)
    return (
      <Login
        desktop={client.desktop}
        error={error}
        onSubmit={async (value) => {
          setError('');
          try {
            await client.login(value);
            setAuthenticated(true);
            await reloadLists();
          } catch (e) {
            fail(e);
          }
        }}
      />
    );
  if (settings)
    return (
      <Settings
        providers={providers}
        client={client}
        snapshot={snapshot}
        close={() => {
          setSettings(false);
          const preferred = localStorage.getItem('praxis-default-provider');
          if (!selected && providers.some((p) => p.id === preferred && p.enabled))
            setProviderId(preferred!);
        }}
        saved={reloadLists}
        logout={async () => {
          await client.logout();
          setAuthenticated(false);
          setSelected(null);
          setSessions([]);
          setProviders([]);
          setDraft('');
          setSettings(false);
        }}
      />
    );

  return (
    <div
      className={`app ${sidebar ? 'with-sidebar' : ''} ${panel && kind === 'agent' ? 'with-panel' : ''}`}
    >
      {sidebar && (
        <aside className="sidebar" aria-label="会话侧栏">
          <div className="brand">
            <span className="brand-mark">知</span>
            <span>
              Praxis<small>知行</small>
            </span>
            <button
              className="icon-button mobile-close"
              aria-label="关闭侧栏"
              onClick={() => setSidebar(false)}
            >
              <Icon name="close" />
            </button>
          </div>
          <button className="new-button" onClick={newSession}>
            <Icon name="plus" />新{kind === 'agent' ? '任务' : '对话'}
          </button>
          {client.desktop && (
            <div className="mode-switch" aria-label="模式">
              <button
                className={kind === 'chat' ? 'selected' : ''}
                onClick={() => {
                  setKind('chat');
                  newSession();
                }}
              >
                ChatBot
              </button>
              <button
                className={kind === 'agent' ? 'selected' : ''}
                onClick={() => {
                  setKind('agent');
                  newSession();
                }}
              >
                Agent
              </button>
            </div>
          )}
          <div className="sidebar-label">最近{kind === 'agent' ? '任务' : '对话'}</div>
          <nav className="session-list">
            {sessions
              .filter((s) => s.kind === kind)
              .map((s) => (
                <button
                  key={s.id}
                  className={selected === s.id ? 'selected' : ''}
                  onClick={() => {
                    setSelected(s.id);
                    setError('');
                  }}
                >
                  {s.status === 'running' && <span className="live-dot" />}
                  <span>{s.title}</span>
                </button>
              ))}
            {!sessions.some((s) => s.kind === kind) && (
              <p className="empty-history">你的会话会显示在这里</p>
            )}
          </nav>
          <button className="account" onClick={() => setSettings(true)}>
            <span className="avatar">知</span>
            <span>
              个人空间<small>模型与设置</small>
            </span>
            <Icon name="settings" />
          </button>
        </aside>
      )}
      <main className="workspace">
        <header className="topbar">
          <button
            className="icon-button"
            aria-label="切换侧栏"
            onClick={() => setSidebar(!sidebar)}
          >
            <Icon name="menu" />
          </button>
          <span className="top-title">
            {kind === 'agent' ? 'Agent' : 'Praxis'}
            <span className="muted">{kind === 'agent' ? '本地任务' : 'ChatBot'}</span>
          </span>
          <div className="top-actions">
            {snapshot && (
              <span className={`run-status ${running ? 'is-active' : ''}`} role="status">
                {statusText[snapshot.session.status] ?? snapshot.session.status}
              </span>
            )}
            <button className="text-button" onClick={() => setSettings(true)}>
              设置
            </button>
            {kind === 'agent' && (
              <button
                className="icon-button"
                aria-label="切换变更面板"
                onClick={() => setPanel(!panel)}
              >
                <Icon name="panel" />
              </button>
            )}
          </div>
        </header>
        {kind === 'agent' && (
          <div className="workspace-bar">
            <Icon name="folder" />
            <button
              className="text-button workspace-path"
              disabled={Boolean(selected)}
              onClick={() => {
                void client
                  .selectWorkspace?.()
                  .then((value) => {
                    if (value) setWorkspace(value);
                  })
                  .catch(fail);
              }}
            >
              {snapshot?.session.workspace ?? (workspace || '选择工作区')}
            </button>
            {snapshot && client.setPermissions && (
              <select
                aria-label="Agent 文件权限"
                value={snapshot.session.permissionMode ?? 'workspace-write'}
                onChange={(e) => {
                  void client.setPermissions!(
                    snapshot.session.id,
                    snapshot.session.permissionRevision ?? 0,
                    e.target.value as 'read-only' | 'workspace-write',
                  ).catch(fail);
                }}
              >
                <option value="workspace-write">工作区可写</option>
                <option value="read-only">只读</option>
              </select>
            )}
          </div>
        )}
        <div
          className={`conversation ${!snapshot?.messages.length ? 'is-empty' : ''}`}
          ref={scroll}
          onScroll={() => {
            const element = scroll.current;
            if (element)
              setFollow(element.scrollHeight - element.scrollTop - element.clientHeight < 80);
          }}
        >
          {!snapshot?.messages.length && !partial ? (
            <div className="welcome">
              <span className="welcome-mark">知</span>
              <h1>{kind === 'agent' ? '从想法，到完成。' : '今天，想聊些什么？'}</h1>
              <p>
                {kind === 'agent'
                  ? '选择一个工作区，让知行协助你完成任务。'
                  : '一起梳理思路、理解问题，写下你的下一个想法。'}
              </p>
              <div className="suggestions">
                {(kind === 'agent'
                  ? ['创建一个 HelloWorld 页面', '帮我理解这个项目', '检查项目中的待办事项']
                  : ['解释一个复杂概念', '帮我完善一个想法', '写一个 HelloWorld 页面']
                ).map((text) => (
                  <button
                    key={text}
                    onClick={() => {
                      setDraft(text);
                      input.current?.focus();
                    }}
                  >
                    {text}
                    <span>↗</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages">
              {snapshot?.messages.map((message) =>
                message.role === 'tool' ? (
                  <ToolCard
                    key={message.id}
                    content={message.content}
                    showChange={(id) => {
                      void showChange(id);
                    }}
                  />
                ) : (
                  <article className={`message ${message.role}`} key={message.id}>
                    <div className="message-label">{message.role === 'user' ? '你' : '知行'}</div>
                    <div className="message-content">
                      {message.role === 'user' ? (
                        <p>{message.content}</p>
                      ) : (
                        <MarkdownView content={message.content} />
                      )}
                      {message.status && ['failed', 'interrupted'].includes(message.status) && (
                        <span className="incomplete">未完整结束</span>
                      )}
                    </div>
                    {message.role === 'assistant' && message.content && (
                      <Copy text={message.content} />
                    )}
                  </article>
                ),
              )}
              {partial && (
                <article className="message assistant">
                  <div className="message-label">知行</div>
                  <div className="message-content">
                    <MarkdownView content={partial} />
                    <span className="stream-cursor" />
                  </div>
                </article>
              )}
              {question && selected && (
                <QuestionCard
                  key={question.questionId}
                  question={question}
                  submit={async (answers) => {
                    try {
                      await client.answer?.({
                        sessionId: selected,
                        questionId: question.questionId,
                        turnId: question.turnId,
                        answers,
                      });
                      setQuestion(null);
                    } catch (e) {
                      fail(e);
                    }
                  }}
                />
              )}
            </div>
          )}
        </div>
        {!follow && (
          <button
            className="latest"
            onClick={() => {
              setFollow(true);
              scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' });
            }}
          >
            ↓ 回到最新
          </button>
        )}
        <div className="composer-region">
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="关闭错误提示"
                onClick={() => setError('')}
              >
                <Icon name="close" />
              </button>
            </div>
          )}
          {snapshot?.session.status === 'interrupted' && (
            <p className="recovery-note">
              任务已中断。历史已保留，发送新的要求后继续；未确认的工具效果需要核查。
            </p>
          )}
          <form
            className="composer"
            onSubmit={(e) => {
              void send(e);
            }}
          >
            <textarea
              ref={input}
              aria-label={kind === 'agent' ? '描述任务' : '输入消息'}
              placeholder={kind === 'agent' ? '描述你希望完成的任务…' : '向知行提问…'}
              value={draft}
              rows={2}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  (localStorage.getItem('praxis-send-mode') !== 'modifier' ||
                    e.ctrlKey ||
                    e.metaKey)
                ) {
                  e.preventDefault();
                  if (!running || kind === 'agent') void send();
                }
              }}
            />
            <div className="composer-bottom">
              <select
                aria-label="选择模型"
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
              >
                <option value="" disabled>
                  选择模型
                </option>
                {providers
                  .filter((p) => p.enabled)
                  .map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name || p.model}
                    </option>
                  ))}
              </select>
              {kind === 'agent' && running && (
                <select
                  aria-label="输入方式"
                  value={inputMode}
                  onChange={(e) => setInputMode(e.target.value as 'queue' | 'steer')}
                >
                  <option value="queue">排队任务</option>
                  <option value="steer">追加指导</option>
                </select>
              )}
              <div className="composer-actions">
                {client.regenerate &&
                  selected &&
                  !running &&
                  snapshot?.messages.some((m) => m.role === 'assistant') && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        void client.regenerate!(selected, providerId).catch(fail);
                      }}
                    >
                      重新生成
                    </button>
                  )}
                {running && selected && (
                  <button
                    type="button"
                    className="stop-button"
                    aria-label="停止任务"
                    onClick={() => {
                      void client.cancel(selected).catch(fail);
                    }}
                  >
                    <Icon name="stop" />
                  </button>
                )}
                <button
                  className="send-button"
                  type="submit"
                  aria-label="发送消息"
                  disabled={!draft.trim() || sending || (running && kind === 'chat')}
                >
                  <Icon name="send" />
                </button>
              </div>
            </div>
          </form>
          <p className="composer-hint">
            {kind === 'agent'
              ? '文件与执行结果以工具记录为准。关闭应用会停止任务。'
              : '知行可能会出错。请核查重要信息。'}
          </p>
        </div>
      </main>
      {panel && kind === 'agent' && (
        <aside className="detail-panel">
          <header>
            <h2>文件变更</h2>
            <button
              className="icon-button"
              aria-label="关闭变更面板"
              onClick={() => setPanel(false)}
            >
              <Icon name="close" />
            </button>
          </header>
          {change ? (
            <>
              <div className="change-title">
                {change.path}
                <Copy text={change.path} />
              </div>
              <p className="panel-note">本次工具记录的历史快照</p>
              {change.before !== null && (
                <section>
                  <h3>修改前</h3>
                  <pre className="diff-before">{change.before}</pre>
                </section>
              )}
              <section>
                <h3>{change.before === null ? '创建内容' : '修改后'}</h3>
                <pre className="diff-after">{change.after}</pre>
              </section>
            </>
          ) : (
            <div className="panel-empty">
              <Icon name="folder" />
              <p>
                选择一条文件修改记录
                <br />
                在这里查看变更
              </p>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
function Login({
  desktop,
  error,
  onSubmit,
}: {
  desktop: boolean;
  error: string;
  onSubmit: (input: {
    username: string;
    password: string;
    serverUrl: string;
    apiKey: string;
  }) => Promise<void>;
}) {
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [serverUrl, setServerUrl] = useState('http://127.0.0.1:4310'),
    [apiKey, setApiKey] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <main className="login-page">
      <div className="login-brand">
        <span className="brand-mark">知</span>Praxis
      </div>
      <form
        className="login-form"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void onSubmit({ username, password, serverUrl, apiKey }).finally(() => {
            setBusy(false);
            setPassword('');
            setApiKey('');
          });
        }}
      >
        <h1>欢迎使用知行</h1>
        <p>{desktop ? '连接你的 Praxis 账户，开始对话或本地任务。' : '登录后，继续你的思考。'}</p>
        {desktop ? (
          <>
            <label>
              Praxis 服务地址
              <input
                type="url"
                value={serverUrl}
                required
                onChange={(e) => setServerUrl(e.target.value)}
              />
            </label>
            <label>
              Praxis API Key
              <input
                type="password"
                value={apiKey}
                required
                autoComplete="off"
                placeholder="pxk_.…"
                onChange={(e) => setApiKey(e.target.value)}
              />
            </label>
          </>
        ) : (
          <>
            <label>
              账号
              <input
                value={username}
                required
                autoComplete="username"
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label>
              密码
              <input
                type="password"
                value={password}
                required
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary-button" disabled={busy}>
          {busy ? '正在连接…' : '继续'}
        </button>
        <small>账号由你的 Praxis 管理员创建。</small>
      </form>
      <footer>知行合一 · From thought to action</footer>
    </main>
  );
}
function QuestionCard({
  question,
  submit,
}: {
  question: Question;
  submit: (answers: unknown) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="question-card"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void submit(
          question.questions.map((q) => ({
            id: q.id,
            text: answers[q.id] ?? '',
            skipped: !answers[q.id]?.trim(),
          })),
        ).finally(() => setBusy(false));
      }}
    >
      <h3>需要你的补充</h3>
      {question.questions.map((q) => (
        <label key={q.id}>
          {q.prompt}
          {q.options && (
            <div className="question-options">
              {q.options.map((o) => (
                <button
                  type="button"
                  key={o.id}
                  onClick={() => setAnswers({ ...answers, [q.id]: o.label })}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
          <input
            value={answers[q.id] ?? ''}
            onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
            placeholder="填写回答；留空表示跳过"
          />
        </label>
      ))}
      <button className="primary-button" disabled={busy}>
        提交回答
      </button>
    </form>
  );
}
