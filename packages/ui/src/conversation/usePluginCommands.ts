import type { UserCommand } from '@praxis/contracts';
import { useEffect, useState } from 'react';
import type { PraxisClient } from '../client-types.ts';

export function usePluginCommands(
  client: PraxisClient,
  kind: 'chat' | 'agent',
  run: (value: Omit<UserCommand, 'sessionId' | 'requestId'>) => Promise<void>,
) {
  const [open, setOpen] = useState(false),
    [items, setItems] = useState<Awaited<ReturnType<NonNullable<PraxisClient['pluginCommands']>>>>(
      [],
    );
  const [selected, setSelected] = useState(''),
    [argumentsText, setArgumentsText] = useState('{}');
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !client.pluginCommands) return;
    let current = true;
    setLoading(true);
    setError('');
    setItems([]);
    setSelected('');
    void client
      .pluginCommands(kind)
      .then((value) => {
        if (!current) return;
        setItems(value);
        setSelected(value[0] ? `${value[0].pluginId}/${value[0].name}` : '');
      })
      .catch((failure) => {
        if (current) setError(failure instanceof Error ? failure.message : '无法获取插件命令。');
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [client, kind, open]);
  const command = items.find((item) => `${item.pluginId}/${item.name}` === selected);
  const submit = async () => {
    if (!command || busy) return;
    setBusy(true);
    setError('');
    try {
      const value: unknown = JSON.parse(argumentsText);
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('命令参数必须是 JSON 对象。');
      // JSON.parse creates JSON values; Host validates the command's declared schema again.
      await run({
        pluginId: command.pluginId,
        name: command.name,
        arguments: value as UserCommand['arguments'],
      });
      setOpen(false);
      setArgumentsText('{}');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '命令提交失败。');
    } finally {
      setBusy(false);
    }
  };
  return {
    open,
    setOpen,
    items,
    selected,
    setSelected,
    argumentsText,
    setArgumentsText,
    error,
    loading,
    busy,
    command,
    submit,
  };
}
