import { useEffect, useState } from 'react';
import type { PraxisClient, Profile, Provider, ViewSession } from '../client-types.ts';
export function useIdentity(client: PraxisClient, fail: (error: unknown) => void) {
  const [authenticated, setAuthenticated] = useState(false),
    [checking, setChecking] = useState(true);
  const [sessions, setSessions] = useState<ViewSession[]>([]),
    [providers, setProviders] = useState<Provider[]>([]),
    [providerId, setProviderId] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    void client
      .profile?.()
      .then((value) => {
        if (!cancelled) setProfile(value);
      })
      .catch((error) => {
        if (!cancelled) fail(error);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated, client]);
  const reloadLists = async () => {
    const [all, models] = await Promise.all([client.list(), client.providers()]);
    setSessions(all);
    setProviders(models);
    setProviderId((previous) =>
      models.some((p) => p.id === previous && p.enabled)
        ? previous
        : (models.find((p) => p.enabled && p.id === localStorage.getItem('praxis-default-provider'))
            ?.id ??
          models.find((p) => p.enabled)?.id ??
          ''),
    );
  };
  useEffect(() => {
    let cancelled = false;
    void client
      .current()
      .then(async (ok) => {
        if (cancelled) return;
        setAuthenticated(ok);
        if (ok) await reloadLists();
      })
      .catch((error) => {
        if (!cancelled) fail(error);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);
  return {
    authenticated,
    setAuthenticated,
    checking,
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
