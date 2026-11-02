import { z } from 'zod';

export const approvalResponseSchema = z.strictObject({
  sessionId: z.string().min(1).max(128),
  turnId: z.string().min(1).max(128),
  approvalId: z.string().uuid(),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  decision: z.enum(['approve-once', 'deny']),
});

export const approvalRequestSchema = z.object({
  callId: z.string(),
  toolId: z.string(),
  parameters: z.unknown(),
  reason: z.string(),
  resources: z.record(z.string(), z.string()).optional(),
  approvalId: z.string(),
  sessionId: z.string(),
  turnId: z.string(),
  permissionRevision: z.number().int(),
  argumentsHash: z.string(),
  expiresAt: z.number(),
  requestHash: z.string(),
});
