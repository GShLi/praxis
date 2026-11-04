// Manual CUA fixture: never connects to a Host or changes real settings.
import { createRoot } from 'react-dom/client';
import { App } from '@praxis/ui';
import { settingsFixtureClient } from './settings-ux-fixture-client.ts';

const params = new URLSearchParams(location.search);
if (!location.hash)
  history.replaceState(
    null,
    '',
    `${location.pathname}${location.search}#settings/${params.get('tab') ?? 'mcp'}`,
  );
const container = document.getElementById('root');
if (!container) throw new Error('Missing fixture root');
createRoot(container).render(<App client={settingsFixtureClient(params)} />);
