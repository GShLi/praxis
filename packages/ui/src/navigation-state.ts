export type SettingsTab =
  | 'general'
  | 'personalization'
  | 'appearance'
  | 'models'
  | 'agent'
  | 'mcp'
  | 'plugins'
  | 'data'
  | 'account'
  | 'about';
export function settingsFromHash(): SettingsTab | null {
  const value = location.hash.replace('#settings/', '');
  return [
    'general',
    'personalization',
    'appearance',
    'models',
    'agent',
    'mcp',
    'plugins',
    'data',
    'account',
    'about',
  ].includes(value)
    ? (value as SettingsTab)
    : null;
}
