import { AppRail, SessionSearch } from './Navigation.tsx';
import { Settings } from './Settings.tsx';
import { useAppController } from './app/useAppController.ts';
import { Login } from './auth/Login.tsx';
import type { PraxisClient } from './client-types.ts';
import { ChangePanel } from './conversation/ChangePanel.tsx';
import { Composer } from './conversation/Composer.tsx';
import { Conversation } from './conversation/Conversation.tsx';
import { Sidebar } from './conversation/Sidebar.tsx';
import { TopBar } from './conversation/TopBar.tsx';
import { WorkspaceBar } from './conversation/WorkspaceBar.tsx';
import './styles.css';
export function App({ client: injected }: { client?: PraxisClient }) {
  const {
    client,
    authenticated,
    setAuthenticated,
    checking,
    sessions,
    providers,
    providerId,
    setProviderId,
    kind,
    setKind,
    selected,
    snapshot,
    draft,
    setDraft,
    partial,
    sending,
    error,
    setError,
    settings,
    profile,
    searching,
    setSearching,
    setLoadAttempt,
    sidebar,
    setSidebar,
    panel,
    setPanel,
    workspace,
    setWorkspace,
    question,
    setQuestion,
    change,
    inputMode,
    setInputMode,
    follow,
    setFollow,
    scroll,
    input,
    fail,
    openSettings,
    closeSettings,
    reloadLists,
    running,
    newSession,
    send,
    showChange,
    logout,
    loadingSession,
    empty,
    chooseSession,
  } = useAppController(injected);
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
  const rail = (
    <AppRail
      profile={profile}
      active={settings ? 'settings' : 'chat'}
      home={() => {
        if (settings) closeSettings();
        else newSession();
      }}
      settings={openSettings}
      logout={logout}
    />
  );
  if (settings)
    return (
      <div className="product-shell">
        {rail}
        <Settings
          tab={settings}
          navigate={openSettings}
          providers={providers}
          client={client}
          snapshot={snapshot}
          close={() => {
            closeSettings();
            const preferred = localStorage.getItem('praxis-default-provider');
            if (!selected && providers.some((p) => p.id === preferred && p.enabled))
              setProviderId(preferred!);
          }}
          saved={reloadLists}
          logout={logout}
        />
      </div>
    );
  return (
    <div className="product-shell">
      {rail}
      <div
        className={`app ${sidebar ? 'with-sidebar' : ''} ${panel && kind === 'agent' ? 'with-panel' : ''}`}
      >
        {sidebar && (
          <>
            <button
              className="sidebar-backdrop"
              aria-label="收起会话侧栏"
              onClick={() => setSidebar(false)}
            />
            <Sidebar
              sessions={sessions}
              kind={kind}
              selected={selected}
              setSearching={setSearching}
              setSidebar={setSidebar}
              newSession={newSession}
              chooseSession={chooseSession}
            />
          </>
        )}
        <main className={`workspace ${empty ? 'empty-workspace' : ''}`}>
          <TopBar
            client={client}
            kind={kind}
            setKind={setKind}
            snapshot={snapshot}
            sidebar={sidebar}
            setSidebar={setSidebar}
            panel={panel}
            setPanel={setPanel}
            running={running}
            newSession={newSession}
            empty={empty}
          />
          {kind === 'agent' && (
            <WorkspaceBar
              client={client}
              selected={selected}
              snapshot={snapshot}
              workspace={workspace}
              setWorkspace={setWorkspace}
              fail={fail}
            />
          )}
          <Conversation
            client={client}
            providerId={providerId}
            kind={kind}
            selected={selected}
            snapshot={snapshot}
            partial={partial}
            error={error}
            setError={setError}
            setLoadAttempt={setLoadAttempt}
            question={question}
            setQuestion={setQuestion}
            setFollow={setFollow}
            scroll={scroll}
            fail={fail}
            running={running}
            showChange={showChange}
            loadingSession={loadingSession}
            empty={empty}
          />
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
          <Composer
            client={client}
            providers={providers}
            providerId={providerId}
            setProviderId={setProviderId}
            kind={kind}
            selected={selected}
            snapshot={snapshot}
            draft={draft}
            setDraft={setDraft}
            sending={sending}
            error={error}
            setError={setError}
            inputMode={inputMode}
            setInputMode={setInputMode}
            input={input}
            fail={fail}
            running={running}
            send={send}
            loadingSession={loadingSession}
            empty={empty}
          />
        </main>
        {panel && kind === 'agent' && <ChangePanel setPanel={setPanel} change={change} />}
      </div>
      {searching && (
        <SessionSearch
          sessions={sessions.filter((s) => client.desktop || s.kind === 'chat')}
          select={chooseSession}
          close={() => setSearching(false)}
        />
      )}
    </div>
  );
}
