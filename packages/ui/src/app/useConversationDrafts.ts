import { useMemo, useReducer } from 'react';
import { ConversationDrafts, type DraftReceipt } from './conversation-drafts.ts';

export function useConversationDrafts(scope: string, kind: string, selected: string | null) {
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  const store = useMemo(() => {
    let storage: Storage | undefined;
    try {
      storage = window.sessionStorage;
    } catch {
      /* Private browsing may deny storage. */
    }
    return new ConversationDrafts(storage, scope);
  }, [scope]);
  const key = `${kind}:${selected ?? 'new'}`;
  return {
    draft: store.read(key),
    persistent: store.persistent,
    setDraft: (value: string) => {
      store.write(key, value);
      refresh();
    },
    capture: () => store.capture(key),
    acknowledge: (receipt: DraftReceipt) => {
      store.acknowledge(receipt);
      refresh();
    },
    created: (id: string) => {
      store.move(key, `${kind}:${id}`);
      refresh();
    },
  };
}
