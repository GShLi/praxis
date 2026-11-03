import type {
  McpOAuthStart,
  McpOAuthStarted,
  McpOAuthStatus,
  McpPromptGet,
  McpPromptApply,
  McpPromptPreview,
  McpPromptList,
} from '@praxis/contracts';
import type { Event, UserCommand } from '@praxis/contracts';
import type { AvailableModel, ModelDiscoveryInput } from '@praxis/model-core/provider';
import type { ApprovalRequest } from '@praxis/permissions';

export interface Provider {
  adapter?: string;
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
  | 'host/diagnostics-export'
  | 'plugin/list'
  | 'plugin/inspect'
  | 'plugin/install'
  | 'plugin/set-enabled'
  | 'plugin/commands'
  | 'plugin/run-command'
  | 'mcp/credential-set'
  | 'mcp/credential-clear'
  | 'mcp/oauth-start'
  | 'mcp/oauth-status'
  | 'mcp/oauth-cancel'
  | 'mcp/server-list'
  | 'mcp/server-upsert'
  | 'mcp/server-delete'
  | 'mcp/server-disable'
  | 'mcp/server-enable'
  | 'mcp/test'
  | 'mcp/prompt-list'
  | 'mcp/prompt-preview'
  | 'mcp/prompt-apply'
  | 'mcp/prompt-cancel'
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
    capabilities?: { tools: boolean; resources: boolean; prompts: boolean };
    displayName: string;
    revision: number;
    enabled: boolean;
    protocol: string;
    transport: {
      type: string;
      endpoint?: string;
      executable?: string;
      allowPrivateDestination?: boolean;
    };
    credential?: { type: 'none' | 'bearer' | 'oauth'; storage: 'os' | 'memory' | 'missing' | null };
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
  pluginCommands?(
    kind: 'chat' | 'agent',
  ): Promise<
    Array<{ pluginId: string; version: string; name: string; parameters: Record<string, unknown> }>
  >;
  runPluginCommand?(input: UserCommand): Promise<void>;
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
  exportDiagnostics?(): Promise<Record<string, unknown>>;
  plugins?(): Promise<PluginState>;
  inspectPlugin?(source: string): Promise<PluginReview>;
  installPlugin?(source: string, digest: string, revision: number): Promise<void>;
  enablePlugin?(id: string, enabled: boolean, revision: number): Promise<void>;
  mcpServers?(): Promise<McpState>;
  startMcpOAuth?(input: McpOAuthStart): Promise<McpOAuthStarted>;
  mcpOAuthStatus?(id: string): Promise<McpOAuthStatus>;
  cancelMcpOAuth?(id: string): Promise<McpOAuthStatus>;
  setMcpBearer?(id: string, storeRevision: number, revision: number, token: string): Promise<void>;
  clearMcpCredential?(id: string, storeRevision: number, revision: number): Promise<void>;
  mcpPrompts?(sessionId: string, serverId: string): Promise<McpPromptList>;
  previewMcpPrompt?(input: McpPromptGet): Promise<McpPromptPreview>;
  applyMcpPrompt?(input: McpPromptApply, providerId: string): Promise<void>;
  cancelMcpPrompt?(sessionId: string): Promise<void>;
  saveMcp?(config: unknown, storeRevision: number, configRevision: number | null): Promise<void>;
  deleteMcp?(id: string, storeRevision: number, configRevision: number): Promise<void>;
  disableMcp?(id: string, revision: number): Promise<void>;
  testMcp?(id: string, revision: number): Promise<McpTestResult>;
  enableMcp?(id: string, storeRevision: number, configRevision: number): Promise<void>;
}
