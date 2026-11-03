import type { Permission, ToolDefinition, ToolResult } from '@praxis/contracts';
import { z } from 'zod';
import { schemas } from './schemas.ts';

export interface ProcessService {
  active: boolean;
  execute(
    input: z.infer<typeof schemas.process_exec>,
    signal: AbortSignal,
    permission: Permission,
  ): Promise<unknown>;
  read(input: z.infer<typeof schemas.process_read>, signal: AbortSignal): Promise<unknown>;
  list(input: z.infer<typeof schemas.process_list>): unknown;
  cancel(input: z.infer<typeof schemas.process_cancel>): Promise<unknown>;
  close(): Promise<void>;
}

export type Ask = (
  questions: z.infer<typeof schemas.user_ask>['questions'],
  signal: AbortSignal,
  validate?: (answer: unknown) => void,
) => Promise<unknown>;

/** Owned by one turn; registrations change only before the next model request. */
export interface ToolExtension {
  boundary(): ToolDefinition[];
  execute(name: string, input: unknown, signal: AbortSignal, result: ToolResult): Promise<void>;
  close(): Promise<void>;
}
