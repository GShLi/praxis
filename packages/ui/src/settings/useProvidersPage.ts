import { useEffect, useRef, useState } from 'react';
import { providerModelChoices, parseModelSelection } from '@praxis/model-core/provider-models';
import type { Provider } from '../client-types.ts';
import { errorText } from './controls.tsx';

export function useProvidersPage(providers: Provider[], saved: () => Promise<void>) {
  const [selectedId, setSelectedId] = useState(providers[0]?.id);
  const [editing, setEditing] = useState<{ provider: Provider | undefined } | null>(null);
  const [deleting, setDeleting] = useState<Provider | null>(null);
  const [preferred, setPreferred] = useState(localStorage.getItem('praxis-default-provider') ?? '');
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [refreshFailed, setRefreshFailed] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const choices = providerModelChoices(providers).filter((m) => m.enabled);
  const defaultId = choices.find((m) => m.id === preferred)?.id ?? choices[0]?.id ?? '';
  const selected = providers.find((p) => p.id === selectedId) ?? providers[0];
  const refresh = async (notice: string) => {
    setBusy(true);
    setRefreshFailed(false);
    setMessage(notice);
    try {
      await saved();
    } catch (error) {
      if (active.current) {
        setRefreshFailed(true);
        setMessage(`${notice} 刷新列表失败：${errorText(error)}`);
      }
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const setDefault = (id: string) => {
    localStorage.setItem('praxis-default-provider', id);
    setPreferred(id);
    setMessage('已设为当前客户端的默认模型。');
  };
  const deleted = () => {
    if (deleting && parseModelSelection(preferred).providerId === deleting.id) {
      localStorage.removeItem('praxis-default-provider');
      setPreferred('');
    }
    setDeleting(null);
    void refresh('供应商已删除，历史会话已保留。');
  };
  return {
    selected,
    setSelectedId,
    editing,
    setEditing,
    deleting,
    setDeleting,
    defaultId,
    message,
    busy,
    refreshFailed,
    refresh,
    setDefault,
    deleted,
  };
}
