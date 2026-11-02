import type { AvailableModel, ModelDiscoveryInput } from '../../model-core/src/provider.ts';
import type { Event, Message, Session } from '../../contracts/src/index.ts';
import type { ApprovalRequest } from '../../permissions/src/index.ts';

export interface Provider {
  id: string;
  revision: number;
  name: string;
  model: string;
  baseUrl: string;
  contextWindow: number;
  maxOutputTokens: number;
  enabled: boolean;
  keyConfigured: boolean;
}
export interface ViewSession {
  id: string;
  title: string;
  kind: 'chat' | 'agent';
  status: string;
  workspace?: string;
  permissionRevision?: number;
  permissionMode?: 'read-only' | 'workspace-write';
}
export interface ViewMessage {
  id: string;
  role: string;
  content: string;
  status?: string;
}
export interface PendingQuestion {
  questionId: string;
  turnId: string;
  questions: Array<{ id: string; prompt: string; options?: Array<{ id: string; label: string }> }>;
}
export interface Snapshot {
  approval?: ApprovalRequest | null;
  question?: PendingQuestion | null;
  session: ViewSession;
  messages: ViewMessage[];
  throughSeq: number;
  turnId: string | null;
}
export type HostMethod =
  | 'auth/me'
  | 'provider/delete'
  | 'host/diagnostics'
  | 'plugin/list'
  | 'plugin/inspect'
  | 'plugin/install'
  | 'plugin/set-enabled'
  | 'mcp/server-list'
  | 'mcp/server-upsert'
  | 'mcp/server-disable'
  | 'mcp/test'
  | 'auth/bind'
  | 'auth/clear'
  | 'workspace/open'
  | 'provider/list'
  | 'provider/models'
  | 'provider/save'
  | 'provider/select'
  | 'session/create'
  | 'session/list'
  | 'session/read'
  | 'session/prompt'
  | 'session/cancel'
  | 'session/subscribe'
  | 'session/unsubscribe'
  | 'session/set-permissions'
  | 'session/archive'
  | 'session/delete'
  | 'question/respond'
  | 'approval/respond'
  | 'artifact/read';
export interface DesktopBridge {
  call<T = unknown>(method: HostMethod, params?: unknown): Promise<T>;
  subscribe(listener: (method: string, payload: unknown) => void): () => void;
  selectWorkspace(): Promise<string | null>;
}
declare global {
  interface Window {
    praxis?: DesktopBridge;
  }
}
export interface Profile {
  id: string;
  username: string;
  scopes: string[];
}
export interface ApiKeyInfo {
  id: string;
  name: string;
  scopes: string[];
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}
export interface PluginState {
  revision: number;
  value: Array<{
    manifest: { id: string; version: string; capabilities: string[] };
    digest: string;
    enabled: boolean;
  }>;
  restartRequired?: boolean;
  failures?: Array<{ id: string; mode: string; code: string }>;
}
export interface PluginReview {
  manifest: { id: string; version: string; capabilities: string[] };
  digest: string;
  bytes: number;
  warning: string;
}
export interface McpState {
  revision: number;
  value: Array<{
    id: string;
    namespace: string;
    displayName: string;
    revision: number;
    enabled: boolean;
    protocol: string;
    transport: { type: string; endpoint?: string; executable?: string };
  }>;
}
export interface McpTestResult {
  operationId: string;
  protocol: string;
  toolCount: number;
  rejectedTools: number;
  generation: string;
  capabilities: { tools: boolean; resources: boolean; prompts: boolean };
}
export interface PraxisClient {
  respondApproval?(input: {
    sessionId: string;
    turnId: string;
    approvalId: string;
    requestHash: string;
    decision: 'approve-once' | 'deny';
  }): Promise<void>;
  desktop: boolean;
  login(input: {
    username: string;
    password: string;
    serverUrl: string;
    apiKey: string;
  }): Promise<void>;
  current(): Promise<boolean>;
  logout(): Promise<void>;
  providers(): Promise<Provider[]>;
  discoverModels(input: ModelDiscoveryInput): Promise<AvailableModel[]>;
  saveProvider(input: {
    config: Omit<Provider, 'id' | 'revision' | 'keyConfigured'>;
    apiKey?: string;
    id?: string;
    expectedRevision?: number;
  }): Promise<void>;
  list(): Promise<ViewSession[]>;
  create(kind: 'chat' | 'agent', workspace?: string): Promise<ViewSession>;
  read(id: string): Promise<Snapshot>;
  send(
    id: string,
    text: string,
    providerId: string,
    mode: 'queue' | 'steer',
    turnId: string | null,
  ): Promise<void>;
  cancel(id: string): Promise<void>;
  listen(
    id: string,
    after: number,
    event: (event: Event) => void,
    delta: (text: string) => void,
    failure: (error: Error) => void,
  ): () => void;
  regenerate?(id: string, providerId: string): Promise<void>;
  selectWorkspace?(): Promise<string | null>;
  answer?(input: unknown): Promise<void>;
  readArtifact?(id: string, artifactId: string): Promise<{ kind: string; content: string }>;
  setPermissions?(
    id: string,
    revision: number,
    mode: 'read-only' | 'workspace-write',
  ): Promise<void>;
  createKey?(): Promise<string>;
  profile?(): Promise<Profile>;
  deleteProvider?(id: string, revision: number): Promise<void>;
  keys?(): Promise<ApiKeyInfo[]>;
  revokeKey?(id: string): Promise<void>;
  diagnostics?(): Promise<Record<string, unknown>>;
  plugins?(): Promise<PluginState>;
  inspectPlugin?(source: string): Promise<PluginReview>;
  installPlugin?(source: string, digest: string, revision: number): Promise<void>;
  enablePlugin?(id: string, enabled: boolean, revision: number): Promise<void>;
  mcpServers?(): Promise<McpState>;
  saveMcp?(config: unknown, storeRevision: number, configRevision: number | null): Promise<void>;
  disableMcp?(id: string, revision: number): Promise<void>;
  testMcp?(id: string, revision: number): Promise<McpTestResult>;
}
export class WebClient implements PraxisClient {
  desktop = false;
  private csrf = '';
  private pageId = crypto.randomUUID();
  private runs = new Map<
    string,
    { generationId: string; lease: string; timer: ReturnType<typeof setInterval> }
  >();
  private refreshing: Promise<void> | undefined;
  async request<T>(path: string, method = 'GET', body?: unknown, retry = true): Promise<T> {
    // CSRF is session-bound and shared by same-origin tabs; never persisted in localStorage.
    const cookie = document.cookie.split('; ').find((v) => v.startsWith('praxis_csrf='));
    if (cookie) this.csrf = decodeURIComponent(cookie.slice('praxis_csrf='.length));
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-csrf-token': this.csrf },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 401 && retry && !path.startsWith('/v1/auth/')) {
      this.refreshing ??= (async () => {
        const renew = async () => {
          // Another tab may have rotated cookies while this tab was waiting for the lock.
          const me = await fetch('/v1/me', { credentials: 'same-origin' });
          if (me.ok) {
            this.csrf = ((await me.json()) as { csrfToken: string }).csrfToken;
            return;
          }
          const result = await this.request<{ csrfToken: string }>(
            '/v1/auth/refresh',
            'POST',
            {},
            false,
          );
          this.csrf = result.csrfToken;
        };
        if (navigator.locks) await navigator.locks.request('praxis-cookie-refresh', renew);
        else await renew();
      })().finally(() => {
        this.refreshing = undefined;
      });
      await this.refreshing;
      return this.request<T>(path, method, body, false);
    }
    const result = (await response.json()) as T & { safeMessage?: string };
    if (!response.ok) throw new Error(result.safeMessage ?? `请求失败（${response.status}）`);
    return result;
  }
  async current() {
    try {
      const me = await this.request<{ csrfToken: string }>('/v1/me');
      this.csrf = me.csrfToken;
      return true;
    } catch {
      return false;
    }
  }
  async login(input: { username: string; password: string }) {
    const result = await this.request<{ csrfToken: string }>('/v1/auth/login', 'POST', {
      username: input.username,
      password: input.password,
      kind: 'web',
    });
    this.csrf = result.csrfToken;
  }
  async logout() {
    for (const [id] of this.runs) await this.cancel(id);
    await this.request('/v1/auth/logout', 'POST', {});
    this.csrf = '';
  }
  providers() {
    return this.request<Provider[]>('/v1/providers');
  }
  discoverModels(input: ModelDiscoveryInput) {
    return this.request<AvailableModel[]>('/v1/providers/discover-models', 'POST', input);
  }
  async saveProvider(input: {
    config: Omit<Provider, 'id' | 'revision' | 'keyConfigured'>;
    apiKey?: string;
    id?: string;
    expectedRevision?: number;
  }) {
    await this.request(
      `/v1/providers${input.id ? '/' + encodeURIComponent(input.id) : ''}`,
      input.id ? 'PUT' : 'POST',
      {
        config: input.config,
        ...(input.apiKey ? { apiKey: input.apiKey } : {}),
        ...(input.id ? { expectedRevision: input.expectedRevision } : {}),
      },
    );
  }
  async list() {
    const rows =
      await this.request<Array<{ id: string; title: string; active_generation: string | null }>>(
        '/v1/chats',
      );
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      kind: 'chat' as const,
      status: row.active_generation ? 'running' : 'idle',
    }));
  }
  async create() {
    const row = await this.request<{ id: string; title: string }>('/v1/chats', 'POST', {});
    return { ...row, kind: 'chat' as const, status: 'idle' };
  }
  async read(id: string): Promise<Snapshot> {
    const result = await this.request<{
      chat: { id: string; title: string; active_generation: string | null };
      inputs: Array<{ id: string; content: string; selected_generation: string | null }>;
      generations: Array<{ id: string; input_id: string; status: string; content: string }>;
      throughSeq: number;
    }>(`/v1/chats/${id}/history`);
    const messages: ViewMessage[] = [];
    for (const input of result.inputs) {
      messages.push({ id: input.id, role: 'user', content: input.content });
      const candidates = result.generations.filter((g) => g.input_id === input.id);
      const selected =
        candidates.find((g) => g.id === input.selected_generation) ?? candidates.at(-1);
      if (selected)
        messages.push({
          id: selected.id,
          role: 'assistant',
          content: selected.content,
          status: selected.status,
        });
    }
    return {
      session: {
        id,
        title: result.chat.title,
        kind: 'chat',
        status: result.chat.active_generation ? 'running' : 'idle',
      },
      messages,
      throughSeq: result.throughSeq,
      turnId: result.chat.active_generation,
    };
  }
  private async submit(id: string, body: unknown, regenerate: boolean) {
    const result = await this.request<{ generationId: string; lease: string }>(
      `/v1/chats/${id}/${regenerate ? 'regenerate' : 'messages'}`,
      'POST',
      body,
    );
    const previous = this.runs.get(id);
    if (previous) clearInterval(previous.timer);
    const beat = () => {
      void this.request(`/v1/chats/${id}/generations/${result.generationId}/heartbeat`, 'POST', {
        pageId: this.pageId,
        lease: result.lease,
      }).catch(() => {
        const run = this.runs.get(id);
        if (run) clearInterval(run.timer);
        this.runs.delete(id);
      });
    };
    this.runs.set(id, { ...result, timer: setInterval(beat, 5000) });
    beat();
  }
  send(id: string, text: string, providerId: string) {
    return this.submit(
      id,
      { requestId: crypto.randomUUID(), text, providerId, pageId: this.pageId },
      false,
    );
  }
  regenerate(id: string, providerId: string) {
    return this.submit(
      id,
      { requestId: crypto.randomUUID(), providerId, pageId: this.pageId },
      true,
    );
  }
  async cancel(id: string) {
    const run = this.runs.get(id);
    const generation = run?.generationId ?? (await this.read(id)).turnId;
    if (generation)
      await this.request(`/v1/chats/${id}/generations/${generation}/cancel`, 'POST', {});
  }
  listen(
    id: string,
    after: number,
    event: (event: Event) => void,
    delta: (text: string) => void,
    failure: (error: Error) => void,
  ) {
    const source = new EventSource(
      `/v1/chats/${id}/events?afterSeq=${after}&pageId=${this.pageId}`,
    );
    source.addEventListener('session-event', (raw: MessageEvent<string>) => {
      const value = JSON.parse(raw.data) as Event;
      if (value.type === 'generation/finished') {
        const run = this.runs.get(id);
        if (run) clearInterval(run.timer);
        this.runs.delete(id);
      }
      event(value);
    });
    source.addEventListener('delta', (raw: MessageEvent<string>) =>
      delta((JSON.parse(raw.data) as { text: string }).text),
    );
    source.onerror = () => failure(new Error('连接中断，正在尝试恢复。'));
    return () => source.close();
  }
  profile() {
    return this.request<Profile>('/v1/me');
  }
  keys() {
    return this.request<ApiKeyInfo[]>('/v1/api-keys');
  }
  async revokeKey(id: string) {
    await this.request(`/v1/api-keys/${encodeURIComponent(id)}`, 'DELETE');
  }
  async deleteProvider(id: string, revision: number) {
    await this.request(`/v1/providers/${encodeURIComponent(id)}`, 'DELETE', {
      expectedRevision: revision,
    });
  }
  async createKey() {
    const result = await this.request<{ key: string }>('/v1/api-keys', 'POST', {
      name: 'Praxis 客户端',
      scopes: ['profile:read', 'providers:read', 'providers:write', 'client:direct'],
      days: 90,
    });
    return result.key;
  }
}
export class LocalClient implements PraxisClient {
  desktop = true;
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
    return (await this.bridge.call<Session[]>('session/list'))
      .filter((s) => !s.archived)
      .map((s) => ({
        ...s,
        permissionRevision: s.permission.revision,
        permissionMode: s.permission.mode,
      }));
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
      void this.bridge.call('session/unsubscribe', { sessionId: id }).catch(() => {});
    };
  }
  profile() {
    return this.bridge.call<Profile>('auth/me');
  }
  diagnostics() {
    return this.bridge.call<Record<string, unknown>>('host/diagnostics');
  }
  plugins() {
    return this.bridge.call<PluginState>('plugin/list');
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
  async testMcp(id: string, revision: number) {
    return this.bridge.call<McpTestResult>('mcp/test', {
      serverId: id,
      expectedRevision: revision,
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
