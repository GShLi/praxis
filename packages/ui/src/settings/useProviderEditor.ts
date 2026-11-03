import { normalizeProviderBaseUrl } from '@praxis/model-core/provider';
import {
  providerModels,
  providerModelSchema,
  type ProviderModel,
} from '@praxis/model-core/provider-models';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PraxisClient, Provider } from '../client-types.ts';
import { errorText } from './controls.tsx';
import { useProviderCatalog } from './useProviderCatalog.ts';

function initialDraft(provider?: Provider) {
  return {
    name: provider?.name ?? 'DeepSeek',
    adapter: provider?.adapter ?? 'openai-compatible',
    baseUrl: provider?.baseUrl ?? 'https://api.deepseek.com',
    key: '',
    pendingModel: '',
    enabled: provider?.enabled ?? true,
    models: provider ? providerModels(provider) : ([] as ProviderModel[]),
  };
}
function endpoint(value: string) {
  try {
    return normalizeProviderBaseUrl(value);
  } catch {
    return '';
  }
}

export function useProviderEditor(
  provider: Provider | undefined,
  client: PraxisClient,
  saved: () => void,
) {
  const [draft, setDraft] = useState(() => initialDraft(provider));
  const initial = useRef(JSON.stringify(draft));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const active = useRef(true),
    saving = useRef(false);
  const catalog = useProviderCatalog(client);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const baseUrl = endpoint(draft.baseUrl);
  const canUseSavedKey = Boolean(
    provider?.keyConfigured &&
      baseUrl &&
      baseUrl === endpoint(provider.baseUrl) &&
      draft.adapter === (provider.adapter ?? 'openai-compatible'),
  );
  const change = (patch: Partial<typeof draft>) => {
    if (saving.current) return;
    if ('key' in patch || 'baseUrl' in patch || 'adapter' in patch) catalog.invalidate();
    setDraft((previous) => ({ ...previous, ...patch }));
  };
  const fetchModels = () =>
    catalog.fetch({
      baseUrl,
      adapter: draft.adapter,
      ...(draft.key.trim() ? { apiKey: draft.key.trim() } : {}),
      ...(provider ? { id: provider.id, expectedRevision: provider.revision } : {}),
    });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving.current) return;
    setError('');
    try {
      if (!baseUrl || !draft.name.trim() || (!draft.key.trim() && !canUseSavedKey))
        throw new Error('请填写名称、有效的 HTTPS 地址及对应的 API Key。');
      if (draft.pendingModel.trim()) throw new Error('请先添加或清空手动输入的模型 ID。');
      if (!draft.models.length) throw new Error('请至少添加一个模型。');
      const models = draft.models.map((model) => {
        const parsed = providerModelSchema.safeParse(model);
        if (!parsed.success)
          throw new Error(`${model.model}: ${parsed.error.issues[0]?.message ?? '模型参数无效。'}`);
        return parsed.data;
      });
      if (new Set(models.map((model) => model.model)).size !== models.length)
        throw new Error('模型 ID 不能重复。');
      const primary =
        models.find((m) => m.id === (provider?.defaultModelId ?? 'default')) ?? models[0]!;
      saving.current = true;
      setBusy(true);
      await client.saveProvider({
        config: {
          name: draft.name.trim(),
          adapter: draft.adapter,
          baseUrl,
          enabled: draft.enabled,
          model: primary.model,
          contextWindow: primary.contextWindow,
          maxOutputTokens: primary.maxOutputTokens,
          defaultModelId: primary.id,
          models,
        },
        ...(draft.key.trim() ? { apiKey: draft.key.trim() } : {}),
        ...(provider ? { id: provider.id, expectedRevision: provider.revision } : {}),
      });
      if (active.current) saved();
    } catch (failure) {
      if (active.current) setError(errorText(failure));
    } finally {
      saving.current = false;
      if (active.current) setBusy(false);
    }
  };
  return {
    draft,
    change,
    busy,
    error,
    dirty: JSON.stringify(draft) !== initial.current,
    catalog,
    canUseSavedKey,
    baseUrl,
    fetchModels,
    submit,
  };
}
export type ProviderEditorState = ReturnType<typeof useProviderEditor>;
