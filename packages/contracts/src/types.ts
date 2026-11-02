import type { Permission } from './protocol.ts';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type Kind = 'chat' | 'agent';

export type TurnStatus =
  | 'running'
  | 'waiting_input'
  | 'waiting_approval'
  | 'cancelling'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'interrupted';

export interface Event {
  eventId: string;
  sessionId: string;
  seq: number;
  schemaVersion: 1;
  type: string;
  source: 'user' | 'model' | 'host' | 'tool';
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface Message {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  reasoning?: string;
}

export interface Session {
  id: string;
  ownerUserId: string;
  kind: Kind;
  title: string;
  workspace?: string;
  status: 'idle' | TurnStatus;
  latestSeq: number;
  createdAt: string;
  archived: boolean;
  permission: Permission;
}

export interface ModelConfig {
  id: string;
  revision: number;
  baseUrl: string;
  model: string;
  apiKey: string;
  contextWindow: number;
  maxOutputTokens: number;
}

export interface ToolDefinition {
  id: string;
  modelName: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  toolId: string;
  toolVersion: 1;
  status: 'succeeded' | 'running' | 'failed' | 'denied' | 'cancelled' | 'timed_out' | 'unknown';
  effectState: 'none' | 'committed' | 'partial' | 'unknown';
  data?: unknown;
  error?: { code: string; message: string };
  artifactIds: string[];
  truncated: boolean;
  durationMs: number;
}
