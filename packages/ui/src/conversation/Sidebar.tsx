import { Icon } from '../Navigation.tsx';

import type { AppController } from '../app/useAppController.ts';

export function Sidebar({
  sessions,
  kind,
  selected,
  setSearching,
  setSidebar,
  newSession,
  chooseSession,
}: Pick<
  AppController,
  'sessions' | 'kind' | 'selected' | 'setSearching' | 'setSidebar' | 'newSession' | 'chooseSession'
>) {
  return (
    <aside className="sidebar" aria-label="会话侧栏">
      <div className="sidebar-heading">
        <span className="sidebar-product" title="知行 Praxis">
          Praxis
        </span>
        <button
          className="icon-button"
          aria-label="搜索会话"
          title="搜索会话（⌘ / Ctrl K）"
          onClick={() => setSearching(true)}
        >
          <Icon name="search" />
        </button>
        <button
          className="icon-button"
          aria-label="关闭侧栏"
          title="关闭侧栏"
          onClick={() => setSidebar(false)}
        >
          <Icon name="menu" />
        </button>
      </div>
      <button className="new-button" onClick={newSession}>
        <Icon name="write" />新{kind === 'agent' ? '任务' : '聊天'}
      </button>
      <div className="sidebar-label">最近{kind === 'agent' ? '任务' : ''}</div>
      <nav className="session-list" aria-label="最近会话">
        {sessions
          .filter((s) => s.kind === kind)
          .map((s) => (
            <button
              key={s.id}
              className={selected === s.id ? 'selected' : ''}
              aria-current={selected === s.id ? 'page' : undefined}
              title={s.title}
              onClick={() => chooseSession(s)}
            >
              {s.status === 'running' && <span className="live-dot" />}
              <span>{s.title}</span>
            </button>
          ))}
        {!sessions.some((s) => s.kind === kind) && (
          <p className="empty-history">开始对话后，历史记录会显示在这里。</p>
        )}
      </nav>
    </aside>
  );
}
