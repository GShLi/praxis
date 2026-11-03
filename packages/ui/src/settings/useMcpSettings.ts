import { useEffect, useRef, useState } from 'react';
import type { McpState, PraxisClient } from '../client-types.ts';
import { errorText } from './controls.tsx';

export function useMcpSettings(client: PraxisClient) {
  const [state, setState] = useState<McpState | null>(null);
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<Record<string, number>>({});
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setState(null);
    setChecked({});
    setBusy(false);
    setMessage('');
    void client
      .mcpServers?.()
      .then((value) => {
        if (current === generation.current) setState(value);
      })
      .catch((e) => {
        if (current === generation.current) setMessage(errorText(e));
      });
    return () => {
      generation.current++;
    };
  }, [client]);
  const run = async (operation: () => Promise<string>, refresh = false) => {
    const current = generation.current;
    setBusy(true);
    setMessage('');
    try {
      const message = await operation();
      const next = refresh ? await client.mcpServers?.() : undefined;
      if (current === generation.current) {
        if (next) setState(next);
        setMessage(message);
      }
      return current === generation.current;
    } catch (error) {
      if (current === generation.current) setMessage(errorText(error));
      if (refresh) {
        try {
          const next = await client.mcpServers?.();
          if (next && current === generation.current) setState(next);
        } catch {
          // Keep the original failure; reconnecting/reopening settings reloads the authoritative state.
        }
      }
      return false;
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  return {
    refresh: () => run(async () => '', true),
    state,
    message,
    busy,
    checked,
    check: (id: string, revision: number) => {
      const current = generation.current;
      setChecked((values) => {
        const next = { ...values };
        delete next[id];
        return next;
      });
      return run(async () => {
        const result = await client.testMcp!(id, revision);
        if (current === generation.current) setChecked((values) => ({ ...values, [id]: revision }));
        return `连接成功 · 协议 ${result.protocol} · ${result.toolCount} 个兼容工具 · ${result.rejectedTools} 个不兼容工具。可以启用 Agent 工具。`;
      });
    },
    enable: (id: string, revision: number) =>
      run(async () => {
        await client.enableMcp!(id, state!.revision, revision);
        return '已启用。Agent 可发现工具，业务调用每次需要你确认发送的参数。';
      }, true),
    disable: (id: string) =>
      run(async () => {
        await client.disableMcp!(id, state!.revision);
        return '已停用，相关操作已取消。';
      }, true),
    setBearer: (id: string, revision: number, token: string) =>
      run(async () => {
        await client.setMcpBearer!(id, state!.revision, revision, token);
        return '凭据已保存。请重新检查连接，再启用服务器。';
      }, true),
    clearCredential: (id: string, revision: number) =>
      run(async () => {
        await client.clearMcpCredential!(id, state!.revision, revision);
        return '本地凭据已清除，连接已停用。远端 Token 未撤销。';
      }, true),
    save: (config: unknown) =>
      run(async () => {
        await client.saveMcp!(config, state!.revision, null);
        return '连接已保存，请先检查连接。';
      }, true),
  };
}
