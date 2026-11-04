import { useEffect, useRef, useState } from 'react';
import type { PraxisClient } from '../client-types.ts';
import { errorText } from './controls.tsx';
import { useSettingsResource } from './useSettingsResource.ts';

export function useAccountSettings(client: PraxisClient, logout: () => Promise<void>) {
  const keys = useSettingsResource(client, client.keys ? () => client.keys!() : undefined);
  const [secret, setSecret] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [logoutError, setLogoutError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const scope = useRef({ active: false, busy: false });
  useEffect(() => {
    const current = { active: true, busy: false };
    scope.current = current;
    setSecret('');
    setConfirm(null);
    setLogoutError('');
    setLoggingOut(false);
    return () => {
      current.active = false;
    };
  }, [client]);
  return {
    keys,
    secret,
    confirm,
    setConfirm,
    logoutError,
    busy: keys.busy || loggingOut,
    dismissSecret: () => setSecret(''),
    create: async () => {
      let created = '';
      const done = await keys.run(async () => {
        if (!client.createKey) throw new Error('此客户端不支持创建 Key。');
        created = await client.createKey();
        return 'Key 已创建，请保存下方仅显示本次的密钥。';
      }, 'create');
      if (done) setSecret(created);
    },
    revoke: async (id: string) => {
      const done = await keys.run(async () => {
        if (!client.revokeKey) throw new Error('此客户端不支持撤销 Key。');
        await client.revokeKey(id);
        return 'Key 已撤销；已签发的短期访问凭据会在到期后失效。';
      }, id);
      if (done) setConfirm(null);
    },
    logout: async () => {
      const current = scope.current;
      if (!current.active || current.busy || keys.busy) return;
      current.busy = true;
      setLoggingOut(true);
      setLogoutError('');
      try {
        await logout();
      } catch (error) {
        if (current.active) setLogoutError(errorText(error));
      } finally {
        current.busy = false;
        if (current.active) setLoggingOut(false);
      }
    },
  };
}
