import { useEffect, useRef, useState } from 'react';
import type { PraxisClient, Provider, Snapshot } from './client-types.ts';
import type { SettingsTab } from './navigation-state.ts';
import './settings.css';
import { About } from './settings/About.tsx';
import { Account } from './settings/Account.tsx';
import { AgentSettings } from './settings/AgentSettings.tsx';
import { Appearance } from './settings/Appearance.tsx';
import { categories } from './settings/categories.ts';
import { SettingsIcon } from './settings/controls.tsx';
import { DataSettings } from './settings/DataSettings.tsx';
import { General } from './settings/General.tsx';
import { McpSettings } from './settings/McpSettings.tsx';
import { Models } from './settings/Models.tsx';
import { PluginSettings } from './settings/PluginSettings.tsx';
import { Personalization } from './settings/Personalization.tsx';
import { useSettingsProfile } from './settings/useSettingsProfile.ts';
import { settingsScope } from './settings/settings-scope.ts';
import './settings/styles/personalization.css';

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
  const { profile, profileError, reloadProfile } = useSettingsProfile(client);
  const main = useRef<HTMLElement>(null);
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
                  {visible.some((item) => item.group !== group) && <h2>{group}</h2>}
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
          <div className={`settings-main-inner ${tab === 'models' ? 'providers-main' : ''}`}>
            {tab !== 'models' && (
              <div className="settings-page-heading">
                <h2>{current.title}</h2>
              </div>
            )}
            {!['general', 'appearance', 'models'].includes(tab) && (
              <p className="settings-scope">{settingsScope(tab, client.desktop)}</p>
            )}
            {tab === 'general' && <General providers={providers} />}
            {tab === 'personalization' && <Personalization client={client} />}
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
                reloadProfile={reloadProfile}
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
