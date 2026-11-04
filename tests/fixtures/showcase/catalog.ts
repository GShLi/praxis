import type { McpState, Profile, Provider } from '@praxis/ui/client';

/** All names, capacities and endpoints are fictional presentation data. No secrets. */
export const profile: Profile = {
  id: 'showcase-fictional-lin',
  username: '林知遥 · 演示账号',
  scopes: [],
};

export const providers: Provider[] = [
  provider('xinghe', '星河模型 · 演示', [
    ['chat', '星河 Chat', 128000, 8192],
    ['reason', '星河 Reason', 128000, 16384],
    ['vision', '星河 Vision', 64000, 8192],
  ]),
  provider('beichen', '北辰智能 · 演示', [
    ['pro', '北辰 Pro', 200000, 16384],
    ['fast', '北辰 Flash', 64000, 4096],
  ]),
  provider('qinglan', '青岚代码 · 演示', [
    ['code', '青岚 Code', 128000, 16384],
    ['review', '青岚 Review', 96000, 8192],
    ['small', '青岚 Mini', 32000, 4096],
  ]),
];

function provider(
  id: string,
  name: string,
  models: Array<[id: string, name: string, contextWindow: number, maxOutputTokens: number]>,
): Provider {
  const choices = models.map(([modelId, model, contextWindow, maxOutputTokens]) => ({
    id: modelId,
    model,
    contextWindow,
    maxOutputTokens,
    enabled: true,
  }));
  const first = choices[0]!;
  return {
    id: `showcase-${id}`,
    name,
    revision: 1,
    baseUrl: `https://${id}.example.invalid/v1`,
    model: first.model,
    contextWindow: first.contextWindow,
    maxOutputTokens: first.maxOutputTokens,
    enabled: true,
    // Presentation-only configured state: there is no key or credential store.
    keyConfigured: true,
    defaultModelId: first.id,
    models: choices,
  };
}

export const mcpServers: McpState = {
  revision: 1,
  value: [
    {
      id: 'showcase-design-library',
      namespace: 'design_library',
      // Synthetic enabled snapshot, not a successful connection or granted capability.
      displayName: '山岚 · 设计资料库（演示）',
      revision: 1,
      enabled: true,
      protocol: '2025-11-25',
      capabilities: { tools: true, resources: true, prompts: true },
      transport: { type: 'streamable-http', endpoint: 'https://design.example.invalid/mcp' },
      credential: { type: 'none', storage: null },
    },
    {
      id: 'showcase-content-library',
      namespace: 'content_library',
      displayName: '山岚 · 内容索引（演示）',
      revision: 1,
      enabled: false,
      protocol: '2025-11-25',
      capabilities: { tools: true, resources: true, prompts: false },
      transport: { type: 'streamable-http', endpoint: 'https://content.example.invalid/mcp' },
      credential: { type: 'none', storage: null },
    },
  ],
};
