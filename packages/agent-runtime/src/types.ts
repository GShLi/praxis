import type { Message, ModelConfig, Session } from '@praxis/contracts';
import type { ModelClient } from '@praxis/model-core';
import type { ActivePlugin } from '@praxis/plugin-host';
import type { Approve } from '@praxis/permissions';
import { SessionStore } from '@praxis/storage-local';
import type { Ask, ProcessService, ToolExtension } from '@praxis/tools';
import { ToolExecutor } from '@praxis/tools';

export interface RuntimeOptions {
  model: ModelClient;
  beginUse: (owner: string, signal: AbortSignal) => Promise<ModelConfig>;
  authorizeCommand?: (owner: string, signal: AbortSignal) => Promise<void>;
  interactive?: boolean;
  protectedPaths?: string[];
  plugins?: (kind: 'chat' | 'agent') => readonly ActivePlugin[];
  processes?: (session: Session, store: SessionStore) => ProcessService;
  toolExtension?: (
    session: Session,
    config: ModelConfig,
    approve: Approve,
    signal: AbortSignal,
  ) => Promise<ToolExtension>;
  maxSteps?: number;
  maxTools?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  acquireWorkspace?: (
    root: string,
    signal: AbortSignal,
  ) => Promise<{ release(): Promise<void>; onLost(callback: () => void): void }>;
}

export interface Active {
  command?: boolean;
  id: string;
  controller: AbortController;
  done: Promise<void>;
  steps: number;
  attempts: number;
  tools: number;
  deadline: number;
  executor?: ToolExecutor;
  pluginContext?: Message[];
  providerDescriptor?: Record<string, string>;
  finishing?: boolean;
}

export interface PendingQuestion {
  sessionId: string;
  turnId: string;
  questions: Parameters<Ask>[0];
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}
