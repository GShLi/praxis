import { useState } from 'react';
import type { PraxisClient } from '../client-types.ts';

export function useComposerActions(
  client: PraxisClient,
  selected: string | null,
  reloadLists: () => Promise<void>,
  setLoadAttempt: (update: (value: number) => number) => void,
  fail: (error: unknown) => void,
) {
  const [stopping, setStopping] = useState(false);
  const restore = () => {
    if (!selected || !client.archiveSession) return;
    void client
      .archiveSession(selected, false)
      .then(async () => {
        await reloadLists();
        setLoadAttempt((value) => value + 1);
      })
      .catch(fail);
  };
  const stop = () => {
    if (!selected) return;
    setStopping(true);
    void client
      .cancel(selected)
      .catch(fail)
      .finally(() => setStopping(false));
  };
  return { stopping, restore, stop };
}
