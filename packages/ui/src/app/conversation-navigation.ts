import { providerModelChoices } from '@praxis/model-core/provider-models';
import type { Provider, ViewSession } from '../client-types.ts';
import type { ConversationState } from './useConversationState.ts';

type NavigationState = Pick<
  ConversationState,
  | 'kind'
  | 'selected'
  | 'remembered'
  | 'setSelected'
  | 'setKind'
  | 'setSnapshot'
  | 'setPartial'
  | 'setError'
  | 'setFollow'
  | 'input'
>;

export function conversationNavigation(
  state: NavigationState,
  providers: Provider[],
  setProviderId: (value: string) => void,
  setSidebar: (value: boolean) => void,
  setSearching: (value: boolean) => void,
) {
  const {
    kind,
    selected,
    remembered,
    setSelected,
    setKind,
    setSnapshot,
    setPartial,
    setError,
    setFollow,
    input,
  } = state;
  const newSession = () => {
    remembered.current[kind] = null;
    setSelected(null);
    setSnapshot(null);
    setFollow(true);
    if (window.innerWidth <= 760) setSidebar(false);
    const preferred = localStorage.getItem('praxis-default-provider');
    const model = providerModelChoices(providers).find((p) => p.id === preferred);
    if (model?.enabled) setProviderId(model.id);
    setPartial('');
    setError('');
    input.current?.focus();
  };
  const switchKind = (next: 'chat' | 'agent') => {
    if (next === kind) return;
    remembered.current[kind] = selected;
    setKind(next);
    setSelected(remembered.current[next]);
    setSnapshot(null);
    setPartial('');
    setError('');
  };
  const chooseSession = (session: ViewSession) => {
    remembered.current[session.kind] = session.id;
    setSelected(session.id);
    setKind(session.kind);
    setError('');
    setSearching(false);
    if (window.innerWidth <= 760) setSidebar(false);
  };
  return { newSession, setKind: switchKind, chooseSession };
}
