import { McpPrompts } from '@praxis/mcp-client/prompts';
import { AgentRuntime } from '@praxis/agent-runtime';
import { AuthClient } from '@praxis/auth-client';
import { PraxisError, assert, idSchema } from '@praxis/contracts';
import { McpMaintenance } from '@praxis/mcp-client/maintenance';
import { McpRuntime } from '@praxis/mcp-client/runtime';
import { McpConfigService } from '@praxis/mcp-core';
import { DeepSeekClient } from '@praxis/model-core';
import { PluginHost, PluginInstaller } from '@praxis/plugin-host';
import { SessionStore, hash } from '@praxis/storage-local';
import { schemas } from '@praxis/tools';
import { acquireLease, acquireWorkspaceLease } from '@praxis/workspace';
import path from 'node:path';
import { z } from 'zod';
import { baseData, commonData } from './paths.ts';
export class HostIdentity {
  binding = false;
  discoveryScope = new AbortController();
  auth: AuthClient | undefined;
  store: SessionStore | undefined;
  runtime: AgentRuntime | undefined;
  dataLease: Awaited<ReturnType<typeof acquireLease>> | undefined;
  selectedProvider: string | undefined;
  mcpConfig: McpConfigService | undefined;
  mcpMaintenance: McpMaintenance | undefined;
  mcpRuntime: McpRuntime | undefined;
  mcpPrompts: McpPrompts | undefined;
  pluginInstaller: PluginInstaller | undefined;
  pluginHosts: Record<'chat' | 'agent', PluginHost> | undefined;
  pluginsChanged = false;
  pluginFailures: Array<{ id: string; mode: string; code: string }> = [];
  readonly workspaces = new Map<string, string>();
  readonly subscriptions = new Map<string, number>();
  constructor(
    private clientKind: () => 'cli' | 'desktop',
    private isClosing: () => boolean,
    private shutdown: () => void,
    private notify: (method: string, params: unknown) => void,
  ) {}
  async clear() {
    this.discoveryScope.abort();
    this.discoveryScope = new AbortController();
    this.subscriptions.clear();
    this.mcpPrompts?.close();
    this.mcpPrompts = undefined;
    await this.mcpMaintenance?.close();
    this.mcpMaintenance = undefined;
    await this.runtime?.close();
    this.runtime = undefined;
    await this.mcpRuntime?.close();
    this.mcpRuntime = undefined;
    if (this.pluginHosts)
      await Promise.all(Object.values(this.pluginHosts).map((host) => host.dispose()));
    this.mcpConfig = undefined;
    this.pluginHosts = undefined;
    this.pluginInstaller = undefined;
    this.pluginsChanged = false;
    this.pluginFailures = [];
    this.store?.close();
    this.store = undefined;
    await this.dataLease?.release();
    this.dataLease = undefined;
    await this.auth?.clear();
    this.auth = undefined;
    this.workspaces.clear();
  }
  async bind(params: unknown) {
    assert(!this.binding, 'AUTH_BUSY', '身份切换正在进行。');
    const input = z
      .strictObject({
        serverUrl: z.string().url(),
        praxisApiKey: z.string().max(1024),
        providerId: idSchema.optional(),
        interactive: z.boolean().default(false),
      })
      .parse(params);
    this.binding = true;
    try {
      await this.clear();
      const candidate = new AuthClient(input.serverUrl);
      await candidate.bind(input.praxisApiKey, AbortSignal.timeout(15_000));
      assert(!this.isClosing(), 'HOST_CLOSING', 'Host 正在退出。');
      const directory = path.join(baseData, this.clientKind(), hash(candidate.userId));
      this.dataLease = await acquireLease(path.join(directory, 'writer.lock'));
      this.dataLease.onLost(() => {
        void this.shutdown();
      });
      this.auth = candidate;
      this.store = new SessionStore(path.join(directory, 'sessions.sqlite'));
      this.store.recover();
      this.selectedProvider = input.providerId;
      this.setupMcp(directory, candidate.userId);
      this.pluginInstaller = new PluginInstaller(path.join(directory, 'plugins'));
      this.pluginHosts = {
        chat: new PluginHost(new Set(Object.keys(schemas)), 'chat'),
        agent: new PluginHost(new Set(Object.keys(schemas)), 'agent'),
      };
      await this.loadPlugins();

      this.runtime = new AgentRuntime(this.store, {
        model: new DeepSeekClient(),
        interactive: input.interactive,
        beginUse: (_owner, signal) => candidate.beginUse(this.selectedProvider, signal),
        authorizeCommand: async (_owner, signal) => {
          await candidate.profile(signal);
        },
        protectedPaths: [baseData, commonData],
        plugins: (kind) => this.pluginHosts?.[kind].snapshot() ?? [],
        toolExtension: (session, config, approve, signal, ask) =>
          this.mcpRuntime!.create(
            session,
            config.contextWindow,
            approve,
            signal,
            [config.apiKey, input.praxisApiKey],
            ask,
          ),
        acquireWorkspace: (root, signal) =>
          acquireWorkspaceLease(root, path.join(commonData, 'workspace-locks'), signal),
      });
      const runtime = this.runtime;
      this.mcpPrompts = new McpPrompts(
        this.mcpRuntime!,
        this.mcpConfig!,
        this.store,
        candidate.userId,
        (value, validate) => runtime.prompt(candidate.userId, value, validate),
        [input.praxisApiKey],
      );
      this.runtime.on('delta', (delta) => this.notify('session/delta', delta));
      this.runtime.on('fatal', () => {
        void this.shutdown();
      });
      return { userId: candidate.userId };
    } catch (error) {
      await this.clear();
      throw error;
    } finally {
      this.binding = false;
    }
  }
  private setupMcp(directory: string, owner: string) {
    const store = this.store;
    assert(store, 'STORAGE_UNAVAILABLE', '会话存储尚未初始化。');
    this.mcpConfig = new McpConfigService(directory, (id) => {
      this.mcpMaintenance?.cancel(id);
      this.mcpRuntime?.invalidate(id);
    });
    this.mcpMaintenance = new McpMaintenance(this.mcpConfig, store, owner, this.clientKind());
    this.mcpRuntime = new McpRuntime(
      this.mcpConfig,
      store,
      this.clientKind(),
      undefined,
      (session) => {
        assert(this.runtime, 'INPUT_UNAVAILABLE', 'Runtime 尚未初始化。');
        return this.runtime.interaction(owner, session.id);
      },
    );
  }
  private async loadPlugins() {
    const installer = this.pluginInstaller,
      hosts = this.pluginHosts;
    assert(installer && hosts, 'PLUGIN_UNAVAILABLE', '插件宿主尚未初始化。');
    for (const record of (await installer.records.read()).value.filter((r) => r.enabled)) {
      for (const mode of record.manifest.modes) {
        try {
          await hosts[mode].load(installer, record);
        } catch (error) {
          this.pluginFailures.push({
            id: record.manifest.id,
            mode,
            code: error instanceof PraxisError ? error.code : 'PLUGIN_ACTIVATION_FAILED',
          });
        }
      }
    }
  }
  require() {
    const { auth, store, runtime, mcpConfig, mcpMaintenance, pluginInstaller } = this;
    assert(
      auth && store && runtime && mcpConfig && mcpMaintenance && pluginInstaller && !this.binding,
      'UNAUTHENTICATED',
      '请先使用 Praxis 身份登录。',
    );
    return { auth, store, runtime, mcpConfig, mcpMaintenance, pluginInstaller, owner: auth.userId };
  }
}
