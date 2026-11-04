import type { AppController } from './app/useAppController.ts';
import { SessionSearch } from './Navigation.tsx';
import { Sidebar } from './conversation/Sidebar.tsx';
import { TopBar } from './conversation/TopBar.tsx';
import { WorkspaceBar } from './conversation/WorkspaceBar.tsx';
import { Conversation } from './conversation/Conversation.tsx';
import { Composer } from './conversation/Composer.tsx';
import { ChangePanel } from './conversation/ChangePanel.tsx';
import { TaskOverview } from './conversation/TaskOverview.tsx';

export function ConversationWorkspace({ controller: c }: { controller: AppController }) {
  return (
    <>
      <div
        className={`app ${c.sidebar ? 'with-sidebar' : ''} ${c.panel && c.kind === 'agent' ? 'with-panel' : ''}`}
      >
        {c.sidebar && (
          <>
            <button
              className="sidebar-backdrop"
              aria-label="收起会话侧栏"
              onClick={() => c.setSidebar(false)}
            />
            <Sidebar {...c} />
          </>
        )}
        <main className={`workspace ${c.empty ? 'empty-workspace' : ''}`}>
          <TopBar {...c} />
          {c.kind === 'agent' && <WorkspaceBar {...c} />}
          {c.kind === 'agent' && c.snapshot?.session.id === c.selected && (
            <TaskOverview
              snapshot={c.snapshot}
              events={c.snapshot.events ?? []}
              partial={c.partial}
              showChange={c.showChange}
              onInteract={() =>
                c.scroll.current
                  ?.querySelector('.approval-card, .question-card')
                  ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
              }
            />
          )}
          <Conversation {...c} />
          <ConversationFooter controller={c} />
        </main>
        {c.panel && c.kind === 'agent' && (
          <ChangePanel
            setPanel={c.setPanel}
            change={c.change}
            loading={c.changeLoading}
            error={c.changeError}
            onRetry={c.retryChange}
          />
        )}
      </div>
      {c.searching && (
        <SessionSearch
          sessions={c.sessions.filter(
            (s) => !s.archived && (c.client.desktop || s.kind === 'chat'),
          )}
          select={c.chooseSession}
          close={() => c.setSearching(false)}
        />
      )}
    </>
  );
}

function ConversationFooter({ controller: c }: { controller: AppController }) {
  return (
    <div className="conversation-footer">
      {!c.follow && (
        <button
          className="latest"
          onClick={() => {
            c.setFollow(true);
            c.scroll.current?.scrollTo({
              top: c.scroll.current.scrollHeight,
              behavior: 'smooth',
            });
          }}
        >
          ↓ 回到最新
        </button>
      )}
      <Composer {...c} />
    </div>
  );
}
