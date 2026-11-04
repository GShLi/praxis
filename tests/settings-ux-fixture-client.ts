import type { ApiKeyInfo, McpState, PluginState, PraxisClient } from '@praxis/ui/client';
import type { UserInstructionSettings } from '@praxis/contracts';
import { providerFixture } from './fixtures/provider-fixture.ts';

/** Browser memory only. All operations below are fake; no Host, file, or model calls. */
export function settingsFixtureClient(params: URLSearchParams): PraxisClient {
  const failed = new Set<string>();
  const failAt = new Set((params.get('fail') ?? '').split(','));
  const delay = params.get('slow') === '1' ? 3000 : 350;
  async function step(name: string) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (failAt.has(name) && !failed.has(name)) {
      failed.add(name);
      throw new Error(`界面样例：${name} 首次失败，重试会成功。`);
    }
  }
  const instructions: UserInstructionSettings = {
    revision: 1,
    value: { enabled: true, text: '已保存的样例偏好。' },
  };
  const mcp: McpState = { revision: 0, value: [] };
  const plugins: PluginState = { revision: 0, value: [] };
  const keys: ApiKeyInfo[] = [];
  let keyCreated = false;
  return {
    desktop: params.get('client') !== 'web',
    current: async () => true,
    login: async () => {},
    logout: async () => {
      throw new Error('界面样例不退出真实账户。');
    },
    profile: async () => ({ id: 'settings-fixture', username: '设置体验样例', scopes: [] }),
    ...providerFixture(),
    list: async () => [],
    create: async () => {
      throw new Error('界面样例不能创建真实会话。');
    },
    read: async () => {
      throw new Error('界面样例没有真实会话。');
    },
    send: async () => {
      throw new Error('界面样例不会调用模型。');
    },
    cancel: async () => {},
    listen: () => () => {},
    userInstructions: async () => {
      await step('instructions-load');
      return structuredClone(instructions);
    },
    saveUserInstructions: async (input) => {
      await step('instructions-save');
      instructions.revision++;
      instructions.value = input.value;
      return structuredClone(instructions);
    },
    mcpServers: async () => {
      await step('mcp-load');
      return structuredClone(mcp);
    },
    saveMcp: async (raw) => {
      await step('mcp-save');
      if (
        typeof raw !== 'object' ||
        raw === null ||
        !('id' in raw) ||
        !('namespace' in raw) ||
        !('displayName' in raw)
      )
        throw new Error('样例需要连接信息。');
      mcp.revision++;
      const server = {
        id: String(raw.id),
        namespace: String(raw.namespace),
        displayName: String(raw.displayName),
        revision: 1,
        enabled: false,
        protocol: 'auto',
        transport: { type: 'streamable-http', endpoint: 'https://fixture.example/mcp' },
      };
      mcp.value = [...mcp.value.filter((item) => item.id !== server.id), server];
    },
    deleteMcp: async (id) => {
      await step('mcp-delete');
      mcp.value = mcp.value.filter((item) => item.id !== id);
      mcp.revision++;
    },
    plugins: async () => {
      await step('plugin-load');
      return structuredClone(plugins);
    },
    selectPluginDirectory: async () => {
      await step('plugin-picker');
      return params.get('picker') === 'cancel' ? null : '/fixture/可信插件样例';
    },
    inspectPlugin: async () => {
      await step('plugin-inspect');
      return {
        manifest: { id: 'fixture.plugin', version: '1.0.0', capabilities: ['tools'] },
        digest: 'fixture-digest',
        bytes: 1024,
        warning: '这是浏览器内的虚构插件。真实插件以 Host 权限执行，仅信任你确认过的来源。',
      };
    },
    installPlugin: async () => {
      await step('plugin-install');
      plugins.revision++;
      plugins.value = [
        {
          manifest: { id: 'fixture.plugin', version: '1.0.0', capabilities: ['tools'] },
          digest: 'fixture-digest',
          enabled: false,
        },
      ];
    },
    enablePlugin: async (id, enabled) => {
      await step('plugin-enable');
      plugins.value = plugins.value.map((item) =>
        item.manifest.id === id ? { ...item, enabled } : item,
      );
      plugins.revision++;
      plugins.restartRequired = true;
    },
    keys: async () => {
      await step(keyCreated ? 'key-refresh' : 'key-load');
      return structuredClone(keys);
    },
    createKey: async () => {
      await step('key-create');
      keyCreated = true;
      keys.push({
        id: `fixture-${keys.length}`,
        name: '样例 Key',
        scopes: [],
        expires_at: '2099-01-01',
        revoked_at: null,
        last_used_at: null,
      });
      return 'fixture-only-NOT-A-REAL-KEY';
    },
    revokeKey: async (id) => {
      await step('key-revoke');
      const key = keys.find((item) => item.id === id);
      if (key) key.revoked_at = new Date().toISOString();
    },
  };
}
