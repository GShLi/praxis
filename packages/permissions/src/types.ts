import { PraxisError } from '@praxis/contracts';
import type { z } from 'zod';
import type { approvalRequestSchema } from './schema.ts';

export interface ApprovalDetails {
  callId: string;
  toolId: string;
  parameters: unknown;
  reason: string;
  resources?: Record<string, string> | undefined;
}

export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

export type ApprovalGrant = () => void;

export type Approve = (details: ApprovalDetails, signal: AbortSignal) => Promise<ApprovalGrant>;

export interface Pending {
  request: ApprovalRequest;
  current: () => boolean;
  detached: boolean;
  resolve(): void;
  reject(error: PraxisError): void;
}
