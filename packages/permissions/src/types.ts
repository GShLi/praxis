import { PraxisError } from '@praxis/contracts';

export interface ApprovalDetails {
  callId: string;
  toolId: string;
  parameters: unknown;
  reason: string;
  resources?: Record<string, string>;
}

export interface ApprovalRequest extends ApprovalDetails {
  approvalId: string;
  sessionId: string;
  turnId: string;
  permissionRevision: number;
  argumentsHash: string;
  expiresAt: number;
  requestHash: string;
}

export type ApprovalGrant = () => void;

export type Approve = (details: ApprovalDetails, signal: AbortSignal) => Promise<ApprovalGrant>;

export interface Pending {
  request: ApprovalRequest;
  resolve(): void;
  reject(error: PraxisError): void;
}
