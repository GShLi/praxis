import { useEffect, useState } from 'react';
import { settingsFromHash, type SettingsTab } from '../navigation-state.ts';
import { requestNavigation } from './navigation-guard.ts';
export function useShell(authenticated: boolean) {
  const [settings, setSettings] = useState<SettingsTab | null>(settingsFromHash),
    [searching, setSearching] = useState(false),
    [sidebar, setSidebar] = useState(() => window.innerWidth > 760),
    [panel, setPanel] = useState(false);
  const apply = (tab: SettingsTab | null) => {
    const url = `${location.pathname}${location.search}${tab ? `#settings/${tab}` : ''}`;
    if (location.hash !== (tab ? `#settings/${tab}` : '')) history.pushState(null, '', url);
    setSettings(tab);
  };
  const openSettings = (tab: SettingsTab) => {
    if (settings !== tab) requestNavigation(() => apply(tab));
  };
  const closeSettings = () => {
    requestNavigation(() => apply(null));
  };
  useEffect(() => {
    const changed = () => {
      const next = settingsFromHash();
      if (settings === next) return;
      const previous = `${location.pathname}${location.search}${settings ? `#settings/${settings}` : ''}`;
      const target = `${location.pathname}${location.search}${next ? `#settings/${next}` : ''}`;
      const accepted = requestNavigation(() => {
        history.replaceState(null, '', target);
        setSettings(next);
      });
      if (!accepted) history.replaceState(null, '', previous);
    };
    window.addEventListener('hashchange', changed);
    window.addEventListener('popstate', changed);
    return () => {
      window.removeEventListener('hashchange', changed);
      window.removeEventListener('popstate', changed);
    };
  }, [settings]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!authenticated || settings) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearching(true);
      }
      if (event.key === 'Escape' && !searching && window.innerWidth <= 760) setSidebar(false);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [authenticated, settings, searching]);
  return {
    settings,
    searching,
    setSearching,
    sidebar,
    setSidebar,
    panel,
    setPanel,
    openSettings,
    closeSettings,
    resetShell: () => apply(null),
  };
}
