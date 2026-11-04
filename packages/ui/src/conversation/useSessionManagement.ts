import { useState } from 'react';
import type { ViewSession } from '../client-types.ts';

export function useSessionManagement(
  session: ViewSession,
  saved: () => Promise<void>,
  close: () => void,
) {
  const [title, setTitle] = useState(session.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = title.trim() !== session.title;
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await operation();
      await saved();
      close();
    } catch (error) {
      setError(error instanceof Error ? error.message : '未保存，请重试。');
    } finally {
      setBusy(false);
    }
  };
  return { title, setTitle, busy, error, dirty, run };
}
