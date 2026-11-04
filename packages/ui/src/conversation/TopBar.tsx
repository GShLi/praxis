import { Icon } from '../Navigation.tsx';

import type { AppController } from '../app/useAppController.ts';
import { statusText } from '../conversation/types.ts';

export function TopBar({
  client,
  kind,
  setKind,
  snapshot,
  sidebar,
  setSidebar,
  panel,
  setPanel,
  running,
  newSession,
  empty,
}: Pick<
  AppController,
  | 'client'
  | 'kind'
  | 'setKind'
  | 'snapshot'
  | 'sidebar'
  | 'setSidebar'
  | 'panel'
  | 'setPanel'
  | 'running'
  | 'newSession'
  | 'empty'
>) {
  return (
    <header className="topbar">
      {!sidebar && (
        <div className="collapsed-navigation">
          <button className="icon-button" aria-label="打开侧栏" onClick={() => setSidebar(true)}>
            <Icon name="menu" />
          </button>
          <button
            className="icon-button"
            aria-label={kind === 'agent' ? '新任务' : '新聊天'}
            onClick={newSession}
          >
            <Icon name="write" />
          </button>
        </div>
      )}
      {client.desktop ? (
        <div className="mode-switch" aria-label="工作模式">
          <button
            className={kind === 'chat' ? 'selected' : ''}
            aria-pressed={kind === 'chat'}
            onClick={() => setKind('chat')}
          >
            <Icon name="chat" />
            聊天
          </button>
          <button
            className={kind === 'agent' ? 'selected' : ''}
            aria-pressed={kind === 'agent'}
            onClick={() => setKind('agent')}
          >
            <Icon name="code" />
            Agent
          </button>
        </div>
      ) : (
        empty && (
          <span className="chat-heading">
            <Icon name="chat" />
            聊天
          </span>
        )
      )}
      <div className="top-actions">
        {snapshot && (
          <span className={`run-status ${running ? 'is-active' : ''}`} role="status">
            {statusText[snapshot.session.status] ?? snapshot.session.status}
          </span>
        )}
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
  );
}
