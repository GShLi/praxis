import type { Permission } from '@praxis/contracts';
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
) => Promise<unknown>;
