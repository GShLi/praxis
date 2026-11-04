import { providerModelChoices } from '@praxis/model-core/provider-models';
import { AppRail } from './Navigation.tsx';
import { Settings } from './Settings.tsx';
import { useAppController } from './app/useAppController.ts';
import { Login } from './auth/Login.tsx';
import { ConnectionState } from './auth/ConnectionState.tsx';
import { LogoutDialog } from './auth/LogoutDialog.tsx';
import type { PraxisClient } from './client-types.ts';
import { ConversationWorkspace } from './ConversationWorkspace.tsx';
import './styles.css';

export function App({ client: injected }: { client?: PraxisClient }) {
  const c = useAppController(injected);
  if (c.checking || (c.connectionError && !c.authenticated))
    return (
      <ConnectionState busy={c.checking} error={c.connectionError} retry={c.retryConnection} />
    );
  if (!c.authenticated)
    return (
      <Login
        desktop={c.client.desktop}
        error={c.error}
        onSubmit={async (value) => {
          c.setError('');
          try {
            await c.client.login(value);
            await c.reloadLists();
            c.setAuthenticated(true);
            return true;
          } catch (error) {
            c.fail(error);
            return false;
          }
        }}
      />
    );
  return (
    <div className="product-shell">
      <AppRail
        profile={c.profile}
        active={c.settings ? 'settings' : 'chat'}
        home={() => {
          if (c.settings) c.closeSettings();
          else c.input.current?.focus();
        }}
        settings={c.openSettings}
        logout={c.logout}
      />
      {c.settings ? (
        <Settings
          tab={c.settings}
          navigate={c.openSettings}
          providers={c.providers}
          client={c.client}
          snapshot={c.snapshot}
          close={() => {
            c.closeSettings();
            const preferred = localStorage.getItem('praxis-default-provider');
            if (
              !c.selected &&
              providerModelChoices(c.providers).some((p) => p.id === preferred && p.enabled)
            )
              c.setProviderId(preferred!);
          }}
          saved={c.reloadLists}
          logout={c.logout}
        />
      ) : (
        <ConversationWorkspace controller={c} />
      )}
      <LogoutDialog state={c.logoutState} />
    </div>
  );
}
