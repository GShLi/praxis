import type {
  McpPromptGet,
  McpPromptApply,
  McpPromptPreview,
  McpPromptList,
} from '@praxis/contracts';
import type {
  Event,
  Message,
  Session,
  UserCommand,
  EffectiveConfig,
  Permission,
} from '@praxis/contracts';
import type { AvailableModel, ModelDiscoveryInput } from '@praxis/model-core/provider';
import type {
  DesktopBridge,
  McpState,
  McpTestResult,
  PluginReview,
  PluginState,
  PraxisClient,
  Profile,
  Provider,
  Snapshot,
} from '../client-types.ts';

export class LocalClient implements PraxisClient {
  desktop = true;
  draftNamespace = 'desktop';
  constructor(private bridge: DesktopBridge) {}
  async current() {
    return false;
  }
  async login(input: { serverUrl: string; apiKey: string }) {
    await this.bridge.call('auth/bind', {
      serverUrl: input.serverUrl,
      praxisApiKey: input.apiKey,
      interactive: true,
    });
    this.draftNamespace = `desktop:${new URL(input.serverUrl).origin}`;
  }
  async logout() {
    await this.bridge.call('auth/clear');
  }
  providers() {
    return this.bridge.call<Provider[]>('provider/list');
  }
  discoverModels(input: ModelDiscoveryInput) {
    return this.bridge.call<AvailableModel[]>('provider/models', input);
  }
  async saveProvider(input: unknown) {
    await this.bridge.call('provider/save', input);
  }
  async list() {
    return (await this.bridge.call<Session[]>('session/list', { includeArchived: true })).map(
      (s) => ({
        ...s,
        permissionRevision: s.permission.revision,
        permissionMode: s.permission.mode,
      }),
    );
  }
  async renameSession(id: string, title: string) {
    await this.bridge.call('session/rename', { sessionId: id, title });
  }
  async archiveSession(id: string, archived: boolean) {
    await this.bridge.call('session/archive', { sessionId: id, archived });
  }
  async create(kind: 'chat' | 'agent', workspace?: string) {
    const opened = workspace
      ? await this.bridge.call<{ id: string }>('workspace/open', { path: workspace })
      : undefined;
    const s = await this.bridge.call<Session>('session/create', {
      kind,
      ...(opened ? { workspaceId: opened.id } : {}),
    });
    if (kind === 'agent' && localStorage.getItem('praxis-default-permission') === 'read-only') {
      await this.setPermissions(s.id, s.permission.revision, 'read-only');
      return (await this.read(s.id)).session;
    }
    return { ...s, permissionRevision: s.permission.revision, permissionMode: s.permission.mode };
  }
  async read(id: string): Promise<Snapshot> {
    const result = await this.bridge.call<{
      session: Session;
      messages: Message[];
      throughSeq: number;
      turnId: string | null;
    }>('session/read', { sessionId: id });
    return {
      ...result,
      session: {
        ...result.session,
        permissionRevision: result.session.permission.revision,
        permissionMode: result.session.permission.mode,
      },
    };
  }
  effectiveConfig(sessionId: string) {
    return this.bridge.call<{ snapshot: EffectiveConfig | null; currentPermission: Permission }>(
      'session/config',
      { sessionId },
    );
  }
  async send(
    id: string,
    text: string,
    providerId: string,
    mode: 'queue' | 'steer',
    turnId: string | null,
  ) {
    await this.bridge.call('provider/select', { providerId });
    await this.bridge.call('session/prompt', {
      sessionId: id,
      requestId: crypto.randomUUID(),
      text,
      mode,
      ...(mode === 'steer' && turnId ? { expectedTurnId: turnId } : {}),
    });
  }
  async cancel(id: string) {
    await this.bridge.call('session/cancel', { sessionId: id });
  }
  listen(
    id: string,
    after: number,
    event: (event: Event) => void,
    delta: (text: string) => void,
    failure: (error: Error) => void,
  ) {
    const off = this.bridge.subscribe((method, raw) => {
      const value = raw as Event & { text: string };
      if (value.sessionId !== id) return;
      if (method === 'session/event') event(value);
      if (method === 'session/delta') delta(value.text);
    });
    void this.bridge.call('session/subscribe', { sessionId: id, afterSeq: after }).catch(failure);
    return () => {
      off();
      void this.bridge.call('session/unsubscribe', { sessionId: id }).catch(() => {
        /* Host may already be closed; local listener is removed before this request. */
      });
    };
  }
  profile() {
    return this.bridge.call<Profile>('auth/me');
  }
  diagnostics() {
    return this.bridge.call<Record<string, unknown>>('host/diagnostics');
  }
  exportDiagnostics() {
    return this.bridge.call<Record<string, unknown>>('host/diagnostics-export');
  }
  userInstructions() {
    return this.bridge.call<import('@praxis/contracts').UserInstructionSettings>(
      'user-instructions/read',
    );
  }
  saveUserInstructions(input: import('@praxis/contracts').SaveUserInstructions) {
    return this.bridge.call<import('@praxis/contracts').UserInstructionSettings>(
      'user-instructions/save',
      input,
    );
  }
  plugins() {
    return this.bridge.call<PluginState>('plugin/list');
  }
  pluginCommands(kind: 'chat' | 'agent') {
    return this.bridge.call<
      Array<{
        pluginId: string;
        version: string;
        name: string;
        parameters: Record<string, unknown>;
      }>
    >('plugin/commands', { kind });
  }
  async runPluginCommand(input: UserCommand) {
    await this.bridge.call('plugin/run-command', input);
  }
  inspectPlugin(source: string) {
    return this.bridge.call<PluginReview>('plugin/inspect', { source });
  }
  async installPlugin(source: string, digest: string, revision: number) {
    await this.bridge.call('plugin/install', {
      source,
      expectedDigest: digest,
      expectedRevision: revision,
    });
  }
  async enablePlugin(id: string, enabled: boolean, revision: number) {
    await this.bridge.call('plugin/set-enabled', { id, enabled, expectedRevision: revision });
  }
  mcpPrompts(sessionId: string, serverId: string) {
    return this.bridge.call<McpPromptList>('mcp/prompt-list', { sessionId, serverId });
  }
  previewMcpPrompt(input: McpPromptGet) {
    return this.bridge.call<McpPromptPreview>('mcp/prompt-preview', input);
  }
  async applyMcpPrompt(input: McpPromptApply, providerId: string) {
    await this.bridge.call('provider/select', { providerId });
    await this.bridge.call('mcp/prompt-apply', input);
  }
  async cancelMcpPrompt(sessionId: string) {
    await this.bridge.call('mcp/prompt-cancel', { sessionId });
  }
  async setMcpBearer(id: string, storeRevision: number, revision: number, token: string) {
    await this.bridge.call('mcp/credential-set', {
      serverId: id,
      expectedStoreRevision: storeRevision,
      expectedRevision: revision,
      token,
    });
  }
  async clearMcpCredential(id: string, storeRevision: number, revision: number) {
    await this.bridge.call('mcp/credential-clear', {
      serverId: id,
      expectedStoreRevision: storeRevision,
      expectedRevision: revision,
    });
  }
  startMcpOAuth(input: import('@praxis/contracts').McpOAuthStart) {
    return this.bridge.call<import('@praxis/contracts').McpOAuthStarted>('mcp/oauth-start', input);
  }
  mcpOAuthStatus(id: string) {
    return this.bridge.call<import('@praxis/contracts').McpOAuthStatus>('mcp/oauth-status', { id });
  }
  cancelMcpOAuth(id: string) {
    return this.bridge.call<import('@praxis/contracts').McpOAuthStatus>('mcp/oauth-cancel', { id });
  }
  mcpServers() {
    return this.bridge.call<McpState>('mcp/server-list');
  }
  async saveMcp(config: unknown, storeRevision: number, configRevision: number | null) {
    await this.bridge.call('mcp/server-upsert', {
      config,
      expectedStoreRevision: storeRevision,
      expectedRevision: configRevision,
    });
  }
  async disableMcp(id: string, revision: number) {
    await this.bridge.call('mcp/server-disable', { serverId: id, expectedStoreRevision: revision });
  }
  async deleteMcp(id: string, storeRevision: number, configRevision: number) {
    await this.bridge.call('mcp/server-delete', {
      serverId: id,
      expectedStoreRevision: storeRevision,
      expectedRevision: configRevision,
    });
  }
  async testMcp(id: string, revision: number) {
    return this.bridge.call<McpTestResult>('mcp/test', {
      serverId: id,
      expectedRevision: revision,
    });
  }
  async enableMcp(id: string, storeRevision: number, configRevision: number) {
    await this.bridge.call('mcp/server-enable', {
      serverId: id,
      expectedStoreRevision: storeRevision,
      expectedRevision: configRevision,
    });
  }
  async respondApproval(input: {
    sessionId: string;
    turnId: string;
    approvalId: string;
    requestHash: string;
    decision: 'approve-once' | 'deny';
  }) {
    await this.bridge.call('approval/respond', input);
  }
  async deleteProvider(id: string, revision: number) {
    await this.bridge.call('provider/delete', { id, expectedRevision: revision });
  }
  selectWorkspace() {
    return this.bridge.selectWorkspace();
  }
  selectPluginDirectory() {
    return this.bridge.selectPluginDirectory?.() ?? Promise.resolve(null);
  }
  async answer(input: unknown) {
    await this.bridge.call('question/respond', input);
  }
  readArtifact(id: string, artifactId: string) {
    return this.bridge.call<{ kind: string; content: string }>('artifact/read', {
      sessionId: id,
      artifactId,
    });
  }
  async setPermissions(id: string, revision: number, mode: 'read-only' | 'workspace-write') {
    await this.bridge.call('session/set-permissions', {
      sessionId: id,
      expectedRevision: revision,
      permission: { mode, approval: 'ask', revision },
    });
  }
}
