import { z } from 'zod';

export const approvalResponseSchema = z.strictObject({
  sessionId: z.string().min(1).max(128),
  turnId: z.string().min(1).max(128),
  approvalId: z.string().uuid(),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  decision: z.enum(['approve-once', 'deny']),
});
