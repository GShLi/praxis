import { pollMcpOAuth } from '../clients/mcp-oauth-poll.ts';
import { useEffect, useRef, useState } from 'react';
import type { McpOAuthStart, McpOAuthStarted } from '@praxis/contracts';
import type { PraxisClient } from '../client-types.ts';
import { errorText } from './controls.tsx';
import type { FeedbackVariant } from './settings-resource.ts';

export function useMcpOAuth(client: PraxisClient, completed: () => Promise<boolean>) {
  const [flow, setFlow] = useState<McpOAuthStarted | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [variant, setVariant] = useState<FeedbackVariant>('info');
  const starting = useRef(false);
  const generation = useRef(0),
    active = useRef<string | null>(null);
  const onComplete = useRef(completed);
  onComplete.current = completed;
  useEffect(() => {
    generation.current++;
    starting.current = false;
    setFlow(null);
    setBusy(false);
    setMessage('');
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
        const refreshed = await onComplete.current();
        if (scope.signal.aborted) return;
        setFlow(null);
        setBusy(false);
        setVariant(result.status === 'succeeded' && refreshed ? 'success' : 'error');
        setMessage(
          result.status === 'succeeded'
            ? refreshed
              ? '授权成功，请检查连接后启用。'
              : '授权已完成，但连接状态刷新失败。请重试读取后再检查并启用。'
            : (result.error?.safeMessage ?? '授权已结束。'),
        );
      })
      .catch((error) => {
        if (!scope.signal.aborted) {
          setMessage(errorText(error));
          setVariant('error');
          setBusy(false);
        }
      });
    return () => scope.abort();
  }, [flow, client]);
  const start = async (input: McpOAuthStart) => {
    if (starting.current || active.current) return;
    const current = generation.current;
    starting.current = true;
    setBusy(true);
    setMessage('');
    try {
      if (!client.startMcpOAuth || !client.cancelMcpOAuth)
        throw new Error('此客户端不支持 OAuth 授权。');
      const result = await client.startMcpOAuth(input);
      if (current !== generation.current) {
        await client.cancelMcpOAuth(result.id);
        return;
      }
      active.current = result.id;
      setFlow(result);
    } catch (error) {
      if (current === generation.current) {
        setMessage(errorText(error));
        setVariant('error');
        setBusy(false);
      }
    } finally {
      if (current === generation.current) starting.current = false;
    }
  };
  const cancel = async () => {
    if (!active.current) return;
    const current = generation.current;
    try {
      if (!client.cancelMcpOAuth) throw new Error('此客户端不支持取消授权。');
      await client.cancelMcpOAuth(active.current);
      if (current !== generation.current) return;
      active.current = null;
      setFlow(null);
      setBusy(false);
      setMessage('授权已取消。');
      setVariant('info');
    } catch (error) {
      if (current === generation.current) {
        setMessage(errorText(error));
        setVariant('error');
      }
    }
  };
  return { flow, busy, message, variant, start, cancel };
}
