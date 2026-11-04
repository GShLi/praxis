import { useEffect, useId, useRef, useState } from 'react';
import type { Profile, ViewSession } from './client-types.ts';
import type { SettingsTab } from './navigation-state.ts';
export { settingsFromHash } from './navigation-state.ts';
export type { SettingsTab } from './navigation-state.ts';

const paths = {
  plus: 'M12 5v14M5 12h14',
  send: 'M12 19V5m-6 6 6-6 6 6',
  stop: 'M7 7h10v10H7z',
  menu: 'M4 5h16v14H4zM10 5v14',
  panel: 'M4 5h16v14H4zM15 5v14',
  home: 'm3 10 9-7 9 7v10h-6v-7H9v7H3z',
  settings:
    'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Zm7 9a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  close: 'm6 6 12 12M6 18 18 6',
  folder: 'M3 7h7l2-3h9v15H3z',
  check: 'm5 12 4 4 10-10',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm5-1 5 5',
  write:
    'M12 4H6a3 3 0 0 0-3 3v11a3 3 0 0 0 3 3h11a3 3 0 0 0 3-3v-6M16 3l5 5M10 14l-1 4 4-1L22 8a2 2 0 0 0-5-5l-7 11Z',
  chat: 'M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z',
  code: 'm8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18',
  spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
  copy: 'M9 8h11v13H9zM15 8V3H4v13h5',
  wrap: 'M3 6h18M3 11h13a4 4 0 0 1 0 8h-4m3-3-3 3 3 3M3 16h4',
  logout: 'M9 4H4v16h5M9 12h12m-5-5 5 5-5 5',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 21v-2a7 7 0 0 1 14 0v2',
  model: 'm12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 9 8-4.5M12 12 4 7.5M12 12v9',
  info: 'M12 8h.01M12 11v6M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  back: 'm10 5-7 7 7 7M3 12h18',
  down: 'm6 9 6 6 6-6',
};
export function Icon({ name }: { name: keyof typeof paths }) {
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

export function AppRail({
  profile,
  active,
  home,
  settings,
  logout,
}: {
  profile: Profile | null;
  active: 'chat' | 'settings';
  home: () => void;
  settings: (tab: SettingsTab) => void;
  logout: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const container = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    first = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const navigate = (tab: SettingsTab) => {
    setOpen(false);
    settings(tab);
  };
  return (
    <nav className="app-rail" aria-label="主导航">
      <button
        className={`rail-button ${active === 'chat' ? 'selected' : ''}`}
        aria-label="对话主页"
        title="对话主页"
        onClick={home}
      >
        <Icon name="home" />
      </button>
      <button
        className={`rail-button ${active === 'settings' ? 'selected' : ''}`}
        aria-label="设置"
        title="设置"
        onClick={() => settings('general')}
      >
        <Icon name="settings" />
      </button>
      <div
        className="rail-account"
        ref={container}
        onBlur={(event) => {
          if (event.relatedTarget && !container.current?.contains(event.relatedTarget as Node))
            setOpen(false);
        }}
      >
        <button
          ref={trigger}
          className="avatar account-trigger"
          aria-label="账户菜单"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen(!open)}
          title={profile?.username ?? '账户'}
        >
          {profile?.username.slice(0, 1).toUpperCase() || '知'}
        </button>
        {open && (
          <div id={menuId} className="account-menu" aria-label="账户选项">
            <div className="account-menu-heading">
              <span className="avatar">{profile?.username.slice(0, 1).toUpperCase() || '知'}</span>
              <div>
                <strong>{profile?.username || '个人空间'}</strong>
                <small>知行 Praxis</small>
              </div>
            </div>
            <button ref={first} onClick={() => navigate('account')}>
              <Icon name="person" />
              账户
            </button>
            <button onClick={() => navigate('models')}>
              <Icon name="model" />
              模型供应商
            </button>
            <button onClick={() => navigate('general')}>
              <Icon name="settings" />
              设置
            </button>
            <div className="menu-separator" />
            <button onClick={() => navigate('about')}>
              <Icon name="info" />
              关于知行
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError('');
                void logout().catch((e: unknown) => {
                  setError(e instanceof Error ? e.message : '退出失败，请重试。');
                }).finally(() => setBusy(false));
              }}
            >
              <Icon name="logout" />
              {busy ? '正在退出…' : '退出登录'}
            </button>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}

export function SessionSearch({
  sessions,
  select,
  close,
}: {
  sessions: ViewSession[];
  select: (session: ViewSession) => void;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    previousFocus = useRef(document.activeElement);
  const [query, setQuery] = useState('');
  const results = sessions.filter((s) =>
    s.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      if (previousFocus.current instanceof HTMLElement) previousFocus.current.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="session-search-dialog"
      aria-label="搜索最近会话"
      onClose={close}
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
    >
      <div className="session-search-content">
        <div className="session-search-input">
          <Icon name="search" />
          <input
            autoFocus
            aria-label="搜索最近会话"
            placeholder="搜索最近会话"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0] && !e.nativeEvent.isComposing) {
                e.preventDefault();
                select(results[0]);
              }
            }}
          />
          <button className="icon-button" aria-label="关闭搜索" onClick={close}>
            <Icon name="close" />
          </button>
        </div>
        <div className="search-results">
          <p className="sidebar-label">{query ? `找到 ${results.length} 个会话` : '最近会话'}</p>
          {results.map((session) => (
            <button key={session.id} onClick={() => select(session)}>
              <Icon name={session.kind === 'agent' ? 'code' : 'chat'} />
              <span>{session.title}</span>
            </button>
          ))}
          {!results.length && (
            <p className="search-empty">
              {query ? '没有找到匹配的会话，试试其他关键词。' : '开始对话后，你可以在这里找到它。'}
            </p>
          )}
        </div>
      </div>
    </dialog>
  );
}
