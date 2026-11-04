import { useEffect, type RefObject } from 'react';
import { providerModelChoices } from '@praxis/model-core/provider-models';
import type { PraxisClient, Profile, Provider, ViewSession } from '../client-types.ts';

export function preferredProvider(models: Provider[], previous: string) {
  const choices = providerModelChoices(models);
  return choices.some((p) => p.id === previous && p.enabled)
    ? previous
    : (choices.find((p) => p.enabled && p.id === localStorage.getItem('praxis-default-provider'))
        ?.id ??
        choices.find((p) => p.enabled)?.id ??
        '');
}

interface Connection {
  client: PraxisClient;
  attempt: number;
  reloadLists(): Promise<void>;
  setAuthenticated(value: boolean): void;
  setChecking(value: boolean): void;
  setConnectionError(value: string): void;
}

export function useIdentityConnection({
  client,
  attempt,
  reloadLists,
  setAuthenticated,
  setChecking,
  setConnectionError,
}: Connection) {
  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    setConnectionError('');
    void client
      .current()
      .then(async (ok) => {
        if (cancelled) return;
        if (ok) await reloadLists();
        if (!cancelled) setAuthenticated(ok);
      })
      .catch((error) => {
        if (!cancelled)
          setConnectionError(error instanceof Error ? error.message : '连接失败，请重试。');
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, attempt]);
}

interface Polling {
  client: PraxisClient;
  authenticated: boolean;
  scope: RefObject<{ active: boolean; epoch: number; request: number }>;
  checkIdentity(identity: Profile | undefined): boolean;
  setSessions(value: ViewSession[]): void;
  setListError(value: string): void;
}

export function useSessionListPolling({
  client,
  authenticated,
  scope,
  checkIdentity,
  setSessions,
  setListError,
}: Polling) {
  useEffect(() => {
    if (!authenticated) return;
    let stopped = false,
      pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      const epoch = scope.current.epoch,
        order = scope.current.request;
      try {
        const [rows, identity] = await Promise.all([client.list(), client.profile?.()]);
        if (!stopped && scope.current.epoch === epoch && scope.current.request === order) {
          if (!checkIdentity(identity)) return;
          setSessions(rows);
          setListError('');
        }
      } catch {
        if (!stopped) setListError('会话列表暂时无法更新，已保留上次结果。');
      } finally {
        pending = false;
      }
    };
    const timer = setInterval(() => {
      void refresh();
    }, 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [authenticated, client]);
}
