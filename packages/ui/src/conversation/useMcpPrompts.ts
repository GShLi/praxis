import { useEffect, useRef, useState } from 'react';
import type { McpPromptList, McpPromptPreview } from '@praxis/contracts';
import type { McpState, PraxisClient } from '../client-types.ts';

function stringArguments(text: string): Record<string, string> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('参数必须是 JSON 对象，且每个值都是文本。');
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Object.values(value).every((v) => typeof v === 'string')
  )
    throw new Error('参数必须是 JSON 对象，且每个值都是文本。');
  return value as Record<string, string>;
}
export function useMcpPrompts(
  client: PraxisClient,
  selected: string | null,
  prepare: () => Promise<string>,
  providerId: string,
  mode: 'queue' | 'steer',
  turnId: string | null,
) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [servers, setServers] = useState<McpState['value']>([]),
    [serverId, setServerId] = useState('');
  const [catalog, setCatalog] = useState<McpPromptList | null>(null),
    [name, setName] = useState(''),
    [args, setArgs] = useState('{}');
  const [preview, setPreview] = useState<McpPromptPreview | null>(null);
  const session = useRef(''),
    epoch = useRef(0);
  const cancel = () => {
    ++epoch.current;
    setBusy(false);
    setOpen(false);
    setPreview(null);
    if (session.current)
      void client.cancelMcpPrompt?.(session.current).catch(() => {
        // A closed Host already cancels its controls. A later open loads a new operation.
      });
  };
  useEffect(() => {
    if (session.current && session.current !== selected) cancel();
  }, [selected]);
  useEffect(
    () => () => {
      ++epoch.current;
      if (session.current)
        void client.cancelMcpPrompt?.(session.current).catch(() => {
          // Component disposal removes UI state; Host disposal owns transport cancellation.
        });
    },
    [client],
  );
  const perform = async <T>(action: () => Promise<T>, publish: (value: T) => void) => {
    const token = ++epoch.current;
    setBusy(true);
    setError('');
    try {
      const value = await action();
      if (token === epoch.current) publish(value);
    } catch (failure) {
      if (token === epoch.current)
        setError(failure instanceof Error ? failure.message : '提示词操作失败。');
    } finally {
      if (token === epoch.current) setBusy(false);
    }
  };
  const show = () => {
    setOpen(true);
    setCatalog(null);
    setPreview(null);
    setArgs('{}');
    void perform(
      async () => {
        session.current = await prepare();
        return (await client.mcpServers!()).value.filter(
          (s) => s.enabled && s.capabilities?.prompts,
        );
      },
      (values) => {
        setServers(values);
        setServerId(values[0]?.id ?? '');
      },
    );
  };
  const list = () =>
    perform(
      () => client.mcpPrompts!(session.current, serverId),
      (value) => {
        setCatalog(value);
        setName(value.entries[0]?.name ?? '');
        setPreview(null);
        setArgs('{}');
      },
    );
  const fetchPreview = () =>
    perform(
      () =>
        client.previewMcpPrompt!({
          sessionId: session.current,
          serverId,
          generation: catalog!.generation,
          name,
          arguments: stringArguments(args),
        }),
      setPreview,
    );
  const apply = () =>
    perform(
      async () => {
        if (!providerId) throw new Error('请先选择模型。');
        if (session.current !== selected) throw new Error('当前会话已变化，请重新选择提示词。');
        await client.applyMcpPrompt!(
          {
            sessionId: session.current,
            requestId: crypto.randomUUID(),
            previewId: preview!.previewId,
            contentHash: preview!.contentHash,
            mode,
            ...(mode === 'steer' && turnId ? { expectedTurnId: turnId } : {}),
          },
          providerId,
        );
      },
      () => setOpen(false),
    );
  return {
    open,
    busy,
    error,
    servers,
    serverId,
    catalog,
    name,
    args,
    preview,
    show,
    cancel,
    list,
    fetchPreview,
    apply,
    selectServer: (id: string) => {
      setServerId(id);
      setCatalog(null);
      setPreview(null);
    },
    selectName: (name: string) => {
      setName(name);
      setArgs('{}');
      setPreview(null);
    },
    changeArgs: (value: string) => {
      setArgs(value);
      setPreview(null);
    },
  };
}
