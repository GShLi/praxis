import { useEffect, useRef, useState } from 'react';
import { preferredProvider } from './identity-refresh.ts';
import { useIdentityConnection, useSessionListPolling } from './identity-refresh.ts';
import type { PraxisClient, Profile, Provider, ViewSession } from '../client-types.ts';

export function useIdentity(client: PraxisClient) {
  const [authenticated, authenticate] = useState(false),
    [checking, setChecking] = useState(true),
    [connectionError, setConnectionError] = useState(''),
    [listError, setListError] = useState(''),
    [attempt, setAttempt] = useState(0);
  const [sessions, setSessions] = useState<ViewSession[]>([]),
    [providers, setProviders] = useState<Provider[]>([]),
    [providerId, setProviderId] = useState(''),
    [profile, setProfile] = useState<Profile | null>(null);
  const scope = useRef({ active: true, epoch: 0, request: 0 });
  const boundUser = useRef<string | null>(null);
  useEffect(() => {
    scope.current.active = true;
    return () => {
      scope.current.active = false;
      scope.current.epoch++;
    };
  }, []);
  const setAuthenticated = (value: boolean) => {
    if (!value) {
      scope.current.epoch++;
      boundUser.current = null;
    }
    authenticate(value);
  };
  const checkIdentity = (identity: Profile | undefined) => {
    if (identity && boundUser.current && boundUser.current !== identity.id) {
      setAuthenticated(false);
      setProfile(null);
      setSessions([]);
      setProviders([]);
      setProviderId('');
      setConnectionError('登录账号已在其他窗口改变。请重新连接；原账号的草稿仍单独保留。');
      return false;
    }
    if (identity) boundUser.current = identity.id;
    return true;
  };
  const reloadLists = async () => {
    const epoch = scope.current.epoch,
      order = ++scope.current.request;
    const [all, models, identity] = await Promise.all([
      client.list(),
      client.providers(),
      client.profile?.(),
    ]);
    if (!scope.current.active || scope.current.epoch !== epoch || order !== scope.current.request)
      return;
    if (!checkIdentity(identity)) return;
    setSessions(all);
    setProviders(models);
    setListError('');
    if (identity) setProfile(identity);
    setProviderId((previous) => preferredProvider(models, previous));
  };
  useIdentityConnection({
    client,
    attempt,
    reloadLists,
    setAuthenticated,
    setChecking,
    setConnectionError,
  });
  useSessionListPolling({ client, authenticated, scope, checkIdentity, setSessions, setListError });
  return {
    authenticated,
    setAuthenticated,
    checking,
    connectionError,
    listError,
    retryConnection: () => setAttempt((value) => value + 1),
    sessions,
    setSessions,
    providers,
    setProviders,
    providerId,
    setProviderId,
    profile,
    setProfile,
    reloadLists,
  };
}
