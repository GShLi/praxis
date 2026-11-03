import { useEffect, useState } from 'react';
import { settingsFromHash, type SettingsTab } from '../navigation-state.ts';
export function useShell(authenticated: boolean) {
  const [settings, setSettings] = useState<SettingsTab | null>(settingsFromHash),
    [searching, setSearching] = useState(false),
    [sidebar, setSidebar] = useState(() => window.innerWidth > 760),
    [panel, setPanel] = useState(false);
  const openSettings = (tab: SettingsTab) => {
    if (!window.dispatchEvent(new Event('praxis:before-navigate', { cancelable: true }))) return;
    location.hash = `settings/${tab}`;
    setSettings(tab);
  };
  const closeSettings = () => {
    if (!window.dispatchEvent(new Event('praxis:before-navigate', { cancelable: true }))) return;
    location.hash = '';
    setSettings(null);
  };
  useEffect(() => {
    const changed = () => {
      if (!window.dispatchEvent(new Event('praxis:before-navigate', { cancelable: true }))) {
        history.replaceState(
          null,
          '',
          `${location.pathname}${location.search}${settings ? `#settings/${settings}` : ''}`,
        );
        return;
      }
      setSettings(settingsFromHash());
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
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
  };
}
