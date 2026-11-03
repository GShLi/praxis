import { useEffect, useState } from 'react';
import type { PraxisClient } from '../client-types.ts';
import { errorText } from './controls.tsx';

export function useEffectiveConfig(client: PraxisClient, sessionId: string, throughSeq: number) {
  const [state, setState] = useState<{
    sessionId: string;
    client: PraxisClient;
    value: Awaited<ReturnType<NonNullable<PraxisClient['effectiveConfig']>>>;
  } | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    setMessage('');
    void client
      .effectiveConfig?.(sessionId)
      .then((value) => {
        if (active) setState({ sessionId, client, value });
      })
      .catch((error) => {
        if (active) setMessage(errorText(error));
      });
    return () => {
      active = false;
    };
  }, [client, sessionId, throughSeq]);
  return {
    state: state?.client === client && state.sessionId === sessionId ? state.value : null,
    message,
  };
}
