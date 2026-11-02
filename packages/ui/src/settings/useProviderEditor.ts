import type { AvailableModel } from '@praxis/model-core/provider';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PraxisClient, Provider } from '../client-types.ts';
import { errorText } from './controls.tsx';
export function useProviderEditor(
  provider: Provider | undefined,
  client: PraxisClient,
  saved: () => Promise<void>,
) {
  const [name, setName] = useState(provider?.name ?? 'DeepSeek'),
    [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? 'https://api.deepseek.com'),
    [model, setModel] = useState(provider?.model ?? ''),
    [key, setKey] = useState('');
  const [windowSize, setWindowSize] = useState(provider?.contextWindow ?? 128000),
    [output, setOutput] = useState(provider?.maxOutputTokens ?? 4096),
    [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [models, setModels] = useState<AvailableModel[]>([]),
    [catalogState, setCatalogState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle'),
    [catalogError, setCatalogError] = useState(''),
    [manual, setManual] = useState(false);
  const queryVersion = useRef(0);
  useEffect(
    () => () => {
      queryVersion.current++;
    },
    [],
  );
  const normalizedUrl = (value: string) => {
    try {
      const url = new URL(value.trim());
      return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
        ? url.href.replace(/\/+$/, '')
        : '';
    } catch {
      return '';
    }
  };
  const endpoint = normalizedUrl(baseUrl);
  const canUseSavedKey = Boolean(
    provider?.keyConfigured && endpoint && endpoint === normalizedUrl(provider.baseUrl),
  );
  const fetching = catalogState === 'loading';
  const resetCatalog = () => {
    queryVersion.current++;
    setModels([]);
    setCatalogState('idle');
    setCatalogError('');
    setModel('');
  };
  const fetchModels = async () => {
    if (!endpoint || (!key.trim() && !canUseSavedKey)) return;
    const version = ++queryVersion.current;
    setCatalogState('loading');
    setCatalogError('');
    try {
      const available = await client.discoverModels({
        baseUrl: endpoint,
        ...(key.trim() ? { apiKey: key.trim() } : {}),
        ...(provider ? { id: provider.id, expectedRevision: provider.revision } : {}),
      });
      if (version !== queryVersion.current) return;
      setModels(available);
      setCatalogState('success');
      setModel((current) => current || available[0]?.id || '');
    } catch (failure) {
      if (version !== queryVersion.current) return;
      setModels([]);
      setCatalogState('error');
      setCatalogError(errorText(failure));
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!endpoint || !model.trim()) {
      setError('请填写有效的 Base URL，并选择或输入模型。');
      return;
    }

    if (output >= windowSize / 2) {
      setError('最大输出必须小于上下文窗口的一半。');
      return;
    }
    setBusy(true);
    void client
      .saveProvider({
        config: {
          name,
          model,
          baseUrl: endpoint,
          contextWindow: windowSize,
          maxOutputTokens: output,
          enabled,
        },
        ...(key.trim() ? { apiKey: key.trim() } : {}),
        ...(provider ? { id: provider.id, expectedRevision: provider.revision } : {}),
      })
      .then(async () => {
        setKey('');
        await saved();
      })
      .catch((e) => setError(errorText(e)))
      .finally(() => setBusy(false));
  };
  return {
    name,
    setName,
    baseUrl,
    setBaseUrl,
    model,
    setModel,
    key,
    setKey,
    windowSize,
    setWindowSize,
    output,
    setOutput,
    enabled,
    setEnabled,
    busy,
    error,
    models,
    catalogState,
    catalogError,
    manual,
    setManual,
    endpoint,
    canUseSavedKey,
    fetching,
    resetCatalog,
    fetchModels,
    submit,
  };
}
