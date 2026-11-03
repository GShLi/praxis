import type { Message, ModelConfig, ToolDefinition } from '@praxis/contracts';
import type { ModelUsage } from './usage.ts';

export interface Completion {
  message: Message;
  usage: ModelUsage;
  finishReason: string;
}

export interface ModelRequest {
  /** Correlates a logical request with its snapshot and usage; transport retries share this ID. */
  requestId?: string;
  messages: Message[];
  tools: ToolDefinition[];
  config: ModelConfig;
  purpose: 'agent_step' | 'chat_generation' | 'compaction';
  signal: AbortSignal;
  onDelta: (text: string) => void;
  /** The caller charges the first attempt; adapters must call this before every additional send.
   * A thrown budget/cancellation error ends the request and must never trigger another retry. */
  beforeRetry?: () => void;
}

export interface ModelClient {
  complete(request: ModelRequest): Promise<Completion>;
}
