import type { Message, ModelConfig, ToolDefinition } from '@praxis/contracts';

export interface Completion {
  message: Message;
  usage: { input: number; output: number };
  finishReason: string;
}

export interface ModelRequest {
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
