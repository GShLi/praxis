import type { ProjectInstructions } from './instructions.ts';
import type { Message, ModelConfig, Session, UserInstructionSettings } from '@praxis/contracts';
import type { userInstructionMaterial } from '@praxis/context';
import type { ModelClient } from '@praxis/model-core';
import type { ActivePlugin } from '@praxis/plugin-host';
import type { Approve } from '@praxis/permissions';
import { SessionStore } from '@praxis/storage-local';
import type { Ask, ProcessService, ToolExtension } from '@praxis/tools';
import { ToolExecutor } from '@praxis/tools';

export interface RuntimeOptions {
  model: ModelClient;
  beginUse: (owner: string, signal: AbortSignal) => Promise<ModelConfig>;
  userInstructions?: (owner: string, signal: AbortSignal) => Promise<UserInstructionSettings>;
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
    ask?: Ask,
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
  userInstructions?: ReturnType<typeof userInstructionMaterial>;
  instructions?: ProjectInstructions;
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
  current: () => boolean;
  detached: boolean;
  validate?: (answer: unknown) => void;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}
