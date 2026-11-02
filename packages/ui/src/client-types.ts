import type { Event } from '@praxis/contracts';
import type { AvailableModel, ModelDiscoveryInput } from '@praxis/model-core/provider';
import type { ApprovalRequest } from '@praxis/permissions';

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
