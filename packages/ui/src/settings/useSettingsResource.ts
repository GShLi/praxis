import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { SettingsResource } from './settings-resource.ts';

export function useSettingsResource<T>(owner: object, read: (() => Promise<T>) | undefined) {
  // The client identity owns the resource. Methods on that client are stable capabilities.
  const resource = useMemo(() => new SettingsResource(read), [owner]);
  const snapshot = useSyncExternalStore(
    resource.subscribe,
    resource.getSnapshot,
    resource.getSnapshot,
  );
  useEffect(() => {
    resource.activate();
    void resource.reload();
    return () => resource.dispose();
  }, [resource]);
  return {
    ...snapshot,
    reload: resource.reload,
    run: resource.run,
    clearFeedback: resource.clearFeedback,
  };
}
