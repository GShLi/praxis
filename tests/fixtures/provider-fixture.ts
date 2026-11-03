import type { PraxisClient, Provider } from '@praxis/ui/client';

/** Disposable browser memory only. Never stores a key or sends network requests. */
export function providerFixture(): Pick<
  PraxisClient,
  'providers' | 'discoverModels' | 'saveProvider' | 'deleteProvider'
> {
  const primary = {
    id: 'default',
    model: 'fixture-chat',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    enabled: true,
  };
  let providers: Provider[] = [
    {
      ...primary,
      revision: 1,
      name: 'DeepSeek',
      id: 'fixture',
      baseUrl: 'https://api.deepseek.com',
      keyConfigured: true,
      models: [primary, { ...primary, id: 'reasoning', model: 'fixture-reasoner' }],
    },
    {
      ...primary,
      id: 'fixture-second',
      revision: 1,
      name: 'Example Cloud',
      baseUrl: 'https://models.example.com/v1',
      keyConfigured: true,
    },
    {
      ...primary,
      id: 'fixture-disabled',
      revision: 1,
      name: '测试网关',
      baseUrl: 'https://gateway.example.com/v1',
      keyConfigured: true,
      enabled: false,
    },
  ];
  return {
    async providers() {
      return structuredClone(providers);
    },
    async discoverModels(input) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      if (input.baseUrl.endsWith('/unsupported'))
        throw new Error('界面样例：供应商不支持模型列表。');
      if (input.baseUrl.endsWith('/empty')) return [];
      return [
        'fixture-chat',
        'fixture-reasoner',
        'fixture-code',
        ...Array.from({ length: 20 }, (_, i) => `fixture-model-${i + 1}`),
      ].map((id) => ({ id }));
    },
    async saveProvider(input) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      if (input.config.name.includes('fail'))
        throw new Error('界面样例：保存失败，请修改名称后重试。');
      const previous = providers.find((p) => p.id === input.id);
      if (input.id && previous?.revision !== input.expectedRevision)
        throw new Error('配置已变化。');
      const saved: Provider = {
        ...input.config,
        id: input.id ?? crypto.randomUUID(),
        revision: (previous?.revision ?? 0) + 1,
        keyConfigured: true,
      };
      providers = previous
        ? providers.map((p) => (p.id === previous.id ? saved : p))
        : [...providers, saved];
    },
    async deleteProvider(id, revision) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      if (providers.find((p) => p.id === id)?.revision !== revision)
        throw new Error('配置已变化。');
      providers = providers.filter((p) => p.id !== id);
    },
  };
}
