import { useState } from 'react';
import type { PraxisClient } from '../client-types.ts';

export function useWorkspaceSelection(
  client: PraxisClient,
  chooseWorkspace: (value: string) => void,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const select = async () => {
    setBusy(true);
    setError('');
    try {
      const value = await client.selectWorkspace?.();
      if (value) chooseWorkspace(value);
    } catch (error) {
      setError(error instanceof Error ? error.message : '无法选择目录，请重试。');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, select };
}
