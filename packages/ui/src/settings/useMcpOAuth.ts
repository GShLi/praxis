import { pollMcpOAuth } from '../clients/mcp-oauth-poll.ts';
import { useEffect, useRef, useState } from 'react';
import type { McpOAuthStart, McpOAuthStarted } from '@praxis/contracts';
import type { PraxisClient } from '../client-types.ts';
import { errorText } from './controls.tsx';

export function useMcpOAuth(client: PraxisClient, completed: () => Promise<boolean>) {
  const [flow, setFlow] = useState<McpOAuthStarted | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const generation = useRef(0),
    active = useRef<string | null>(null);
  const onComplete = useRef(completed);
  onComplete.current = completed;
  useEffect(() => {
    generation.current++;
    return () => {
      generation.current++;
      if (active.current)
        void client.cancelMcpOAuth?.(active.current).catch(() => {
          // Host close/config invalidation also revokes the callback; no UI remains to report here.
        });
      active.current = null;
    };
  }, [client]);
  useEffect(() => {
    if (!flow) return;
    const scope = new AbortController();
    void pollMcpOAuth(client, flow.id, scope.signal)
      .then(async (result) => {
        if (scope.signal.aborted) return;
        active.current = null;
        setFlow(null);
        setBusy(false);
        setMessage(
          result.status === 'succeeded'
            ? '授权成功，请检查连接后启用。'
            : (result.error?.safeMessage ?? '授权已结束。'),
        );
        await onComplete.current();
      })
      .catch((error) => {
        if (!scope.signal.aborted) {
          setMessage(errorText(error));
          setBusy(false);
        }
      });
    return () => scope.abort();
  }, [flow, client]);
  const start = async (input: McpOAuthStart) => {
    const current = generation.current;
    setBusy(true);
    setMessage('');
    try {
      const result = await client.startMcpOAuth!(input);
      if (current !== generation.current) {
        await client.cancelMcpOAuth!(result.id);
        return;
      }
      active.current = result.id;
      setFlow(result);
    } catch (error) {
      if (current === generation.current) {
        setMessage(errorText(error));
        setBusy(false);
      }
    }
  };
  const cancel = async () => {
    if (!active.current) return;
    try {
      await client.cancelMcpOAuth!(active.current);
      active.current = null;
      setFlow(null);
      setBusy(false);
      setMessage('授权已取消。');
    } catch (error) {
      setMessage(errorText(error));
    }
  };
  return { flow, busy, message, start, cancel };
}
