import type { Permission } from '@praxis/contracts';
import type { Approve } from '@praxis/permissions';
import type { SessionStore } from '@praxis/storage-local';
import type { z } from 'zod';
import type { schemas } from '../schemas.ts';

export type CommandInput = z.infer<typeof schemas.process_exec>;
export interface CommandPlan {
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  description: string;
  timeoutMs: number;
  sandbox: {
    backend: string;
    policyVersion: number;
    fileMode: Permission['mode'];
    network: 'deny' | 'allow';
  };
}
export interface CommandExit {
  exitCode: number | null;
  signal: string | null;
  cleanup: 'complete' | 'unknown';
}
export interface RunningCommand {
  /** Resolves only after the complete execution domain has been reaped. */
  done: Promise<CommandExit>;
  /** Idempotently requests termination; done confirms actual cleanup. */
  stop(): Promise<void>;
}
export interface PreparedCommand {
  readonly plan: CommandPlan;
  start(
    output: (stream: 'stdout' | 'stderr', data: Buffer) => void,
    signal: AbortSignal,
  ): Promise<RunningCommand>;
  /** Also releases partially initialized resources after a failed start. */
  close(): Promise<void>;
}
export interface CommandBackend {
  /** Resolves the exact launch plan without executing user code. */
  prepare(
    input: CommandInput,
    context: { workspace: string; permission: Permission; deadline: number; signal: AbortSignal },
  ): Promise<PreparedCommand>;
}
export interface ProcessOptions {
  store: SessionStore;
  sessionId: string;
  turnId: string;
  deadline: number;
  backend: CommandBackend;
  approve: Approve;
  onFatal(error: Error): void;
}
export type ProcessState =
  | 'running'
  | 'cancelling'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'unknown';
export interface ExecutionRecord {
  executionId: string;
  turnId: string;
  description: string;
  processState: ProcessState;
  exitCode: number | null;
  signal: string | null;
  startedAt: string;
  finishedAt?: string | undefined;
}
