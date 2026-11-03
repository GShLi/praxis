import { useEffect, useState } from 'react';
import type { PraxisClient, Profile } from '../client-types.ts';
import { errorText } from './controls.tsx';

export function useSettingsProfile(client: PraxisClient) {
  const [profile, setProfile] = useState<Profile | null>(null),
    [profileError, setProfileError] = useState('');
  useEffect(() => {
    let active = true;
    setProfile(null);
    setProfileError('');
    void client
      .profile?.()
      .then((value) => {
        if (active) setProfile(value);
      })
      .catch((error) => {
        if (active) setProfileError(errorText(error));
      });
    return () => {
      active = false;
    };
  }, [client]);
  return { profile, profileError };
}
