import { useState } from 'react';
import { Icon } from '../Navigation.tsx';
import type { AppController } from '../app/useAppController.ts';
import type { ViewSession } from '../client-types.ts';
import { statusText } from './types.ts';
import { sessionGroups } from './session-groups.ts';
import { SessionManagement } from './SessionManagement.tsx';
import './session-history.css';

export function Sidebar({
  sessions,
  kind,
  selected,
  setSearching,
  setSidebar,
  newSession,
  chooseSession,
  client,
  reloadLists,
  setLoadAttempt,
  listError,
  fail,
}: Pick<
  AppController,
  | 'sessions'
  | 'kind'
  | 'selected'
  | 'setSearching'
  | 'setSidebar'
  | 'newSession'
  | 'chooseSession'
  | 'client'
  | 'reloadLists'
  | 'setLoadAttempt'
  | 'listError'
  | 'fail'
>) {
  const [archived, setArchived] = useState(false),
    [managing, setManaging] = useState<ViewSession | null>(null);
  const rows = sessions.filter(
    (session) => session.kind === kind && Boolean(session.archived) === archived,
  );
  const attention = sessions.filter((session) =>
    ['waiting_input', 'waiting_approval'].includes(session.status),
  );
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
      <button
        className="new-button"
        onClick={() => {
          setArchived(false);
          newSession();
        }}
      >
        <Icon name="write" />新{kind === 'agent' ? '任务' : '聊天'}
      </button>
      {attention.length > 0 && (
        <button className="history-attention" onClick={() => chooseSession(attention[0]!)}>
          {attention.length} 个任务需要处理 <Icon name="back" />
        </button>
      )}
      <div className="history-tabs" aria-label="会话范围">
        <button aria-pressed={!archived} onClick={() => setArchived(false)}>
          最近
        </button>
        <button aria-pressed={archived} onClick={() => setArchived(true)}>
          已归档
        </button>
      </div>
      {listError && (
        <p className="empty-history" role="alert">
          {listError}
          <button
            className="text-button"
            onClick={() => {
              void reloadLists().catch(fail);
            }}
          >
            重新读取
          </button>
        </p>
      )}
      <nav className="session-list" aria-label={archived ? '已归档会话' : '最近会话'}>
        {sessionGroups(rows).map((group) => (
          <section key={group.label}>
            <p className="sidebar-label">{group.label}</p>
            {group.rows.map((session) => (
              <div
                className={`history-row ${selected === session.id ? 'selected' : ''}`}
                key={session.id}
              >
                <button
                  className="history-session"
                  aria-current={selected === session.id ? 'page' : undefined}
                  title={session.title}
                  onClick={() => chooseSession(session)}
                >
                  <span>{session.title}</span>
                  <small className={`history-status status-${session.status}`}>
                    {statusText[session.status] ?? '状态待刷新'}
                  </small>
                  {session.workspace && (
                    <small className="history-workspace" title={session.workspace}>
                      {session.workspace.split(/[\\/]/).filter(Boolean).at(-1)}
                    </small>
                  )}
                </button>
                {(client.renameSession || client.archiveSession) && (
                  <button
                    className="history-manage"
                    aria-label={`管理会话：${session.title}`}
                    title="管理会话"
                    onClick={() => setManaging(session)}
                  >
                    ···
                  </button>
                )}
              </div>
            ))}
          </section>
        ))}
        {!rows.length && (
          <p className="empty-history">
            {archived
              ? '归档后的会话会显示在这里，历史记录仍然保留。'
              : '开始对话后，历史记录会显示在这里。'}
          </p>
        )}
      </nav>
      {managing && (
        <SessionManagement
          client={client}
          session={managing}
          close={() => setManaging(null)}
          saved={async () => {
            await reloadLists();
            if (selected === managing.id) setLoadAttempt((value) => value + 1);
          }}
        />
      )}
    </aside>
  );
}
