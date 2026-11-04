import { useState } from 'react';
import type { PraxisClient } from '../client-types.ts';
import { LocalClient } from '../clients/LocalClient.ts';
import { WebClient } from '../clients/WebClient.ts';
import { useConversationSubscription } from './useConversationSubscription.ts';
import { useIdentity } from './useIdentity.ts';
import { useShell } from './useShell.ts';
import { useSessionSubmission } from './useSessionSubmission.ts';
import { useConversationDrafts } from './useConversationDrafts.ts';
import { useFileChanges } from './useFileChanges.ts';
import { useLogout } from './useLogout.ts';
import { useConversationState } from './useConversationState.ts';
import { useConversationViewport } from './useConversationViewport.ts';
import { conversationNavigation } from './conversation-navigation.ts';
import { conversationCommands } from './conversation-commands.ts';

export function useAppController(injected?: PraxisClient) {
  const [client] = useState<PraxisClient>(
    () => injected ?? (window.praxis ? new LocalClient(window.praxis) : new WebClient()),
  );
  const identity = useIdentity(client);
  const { setSessions, setProviders, ...identityView } = identity;
  const state = useConversationState(identity.authenticated);
  const { kind, selected, workspace, fail } = state;
  const {
    remembered,
    selection,
    loadAttempt,
    setSelected,
    setSnapshot,
    setPartial,
    ...conversationView
  } = state;
  const shell = useShell(identity.authenticated);
  const { resetShell, ...shellView } = shell;
  const drafts = useConversationDrafts(
    `${client.desktop ? (client.draftNamespace ?? 'desktop') : 'web'}:${identity.profile?.id ?? 'signed-out'}`,
    kind,
    selected,
  );
  const changes = useFileChanges(client, selected, () => shell.setPanel(true));
  const submission = useSessionSubmission({
    client,
    kind,
    selected,
    workspace,
    identity: identity.authenticated ? (identity.profile?.id ?? null) : null,
    onSelect: (id) => {
      drafts.created(id);
      setSelected(id);
      remembered.current[kind] = id;
    },
    reload: identity.reloadLists,
    fail,
  });
  useConversationViewport(state, drafts.draft, shell.settings);
  useConversationSubscription({
    ...state,
    client,
    authenticated: identity.authenticated,
    onKind: state.setKind,
    onReset: () => state.setFollow(true),
    reloadLists: identity.reloadLists,
  });
  const logoutState = useLogout(client, identity.sessions, () => {
    identity.setAuthenticated(false);
    setSelected(null);
    setSessions([]);
    setProviders([]);
    identity.setProfile(null);
    remembered.current = { chat: null, agent: null };
    resetShell();
  });
  return {
    client,
    ...identityView,
    ...conversationView,
    ...shellView,
    ...changes,
    draft: drafts.draft,
    setDraft: drafts.setDraft,
    draftPersistent: drafts.persistent,
    sending: submission.sending,
    ...conversationNavigation(
      state,
      identity.providers,
      identity.setProviderId,
      shell.setSidebar,
      shell.setSearching,
    ),
    ...conversationCommands({ client, state, drafts, submission, providerId: identity.providerId }),
    logout: logoutState.logout,
    logoutState,
  };
}
export type AppController = ReturnType<typeof useAppController>;
