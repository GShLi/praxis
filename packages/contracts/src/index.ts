import { z } from 'zod';

export const PROTOCOL = { major: 1, minor: 0 } as const;
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;
export const idSchema = z.string().min(1).max(128);
export const textSchema = z
  .string()
  .min(1)
  .refine((s) => new TextEncoder().encode(s).length <= 256 * 1024, 'Text exceeds 256 KiB');
export const initializeSchema = z.strictObject({
  protocolMajor: z.number().int(),
  protocolMinor: z.number().int().nonnegative(),
  clientInstanceId: idSchema,
  clientKind: z.enum(['cli', 'desktop']),
  nonce: z.string().min(16).max(256),
});
export const promptSchema = z.strictObject({
  sessionId: idSchema,
  requestId: idSchema,
  mode: z.enum(['queue', 'steer']).default('queue'),
  text: textSchema,
  expectedTurnId: idSchema.optional(),
});
export type Prompt = z.infer<typeof promptSchema>;
export const permissionSchema = z.strictObject({
  mode: z.enum(['read-only', 'workspace-write']).default('workspace-write'),
  approval: z.enum(['ask', 'never']).default('ask'),
  revision: z.number().int().nonnegative().default(0),
});
export type Permission = z.infer<typeof permissionSchema>;
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
export class PraxisError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'PraxisError';
  }
}
export function assert(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new PraxisError(code, message);
}
export function safeError(error: unknown): {
  code: string;
  safeMessage: string;
  retryable: boolean;
} {
  if (error instanceof PraxisError)
    return { code: error.code, safeMessage: error.message, retryable: error.retryable };
  if (error instanceof z.ZodError)
    return { code: 'INVALID_ARGUMENT', safeMessage: '请求参数不符合协议。', retryable: false };
  if (error instanceof Error && error.name === 'AbortError')
    return { code: 'CANCELLED', safeMessage: '操作已取消。', retryable: false };
  return { code: 'INTERNAL_ERROR', safeMessage: '操作失败，请检查脱敏诊断。', retryable: false };
}
