import { useRef, useState } from 'react';
import type { PraxisClient, ViewSession } from '../client-types.ts';
import { activeStatuses } from '../conversation/session-groups.ts';
import { requestNavigation } from './navigation-guard.ts';

export function useLogout(client: PraxisClient, sessions: ViewSession[], complete: () => void) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const locked = useRef(false);
  const count = sessions.filter((session) => activeStatuses.has(session.status)).length;
  const confirm = async () => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await client.logout();
      complete();
      setOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : '退出失败，请重试。');
      setOpen(true);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  return {
    open,
    busy,
    error,
    count,
    confirm,
    cancel: () => {
      if (!locked.current) {
        setOpen(false);
        setError('');
      }
    },
    logout: async () => {
      requestNavigation(() => {
        if (count) setOpen(true);
        else void confirm();
      });
    },
  };
}
