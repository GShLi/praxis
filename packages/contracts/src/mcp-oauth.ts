import { z } from 'zod';

export const mcpOAuthStartSchema = z.strictObject({
  serverId: z.uuid(),
  expectedStoreRevision: z.number().int().nonnegative(),
  expectedRevision: z.number().int().positive(),
  issuer: z.string().url().max(2048),
  clientId: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[\x21-\x7e]+$/),
  redirectUri: z.string().url().max(2048),
  scopes: z
    .array(
      z
        .string()
        .min(1)
        .max(256)
        .regex(/^[\x21\x23-\x5b\x5d-\x7e]+$/),
    )
    .max(32),
  allowPrivateIssuer: z.boolean().default(false),
});
export type McpOAuthStart = z.infer<typeof mcpOAuthStartSchema>;
export interface McpOAuthStarted {
  id: string;
  authorizationUrl: string;
  expiresAt: number;
}
export interface McpOAuthStatus {
  id: string;
  status: 'waiting' | 'exchanging' | 'succeeded' | 'failed' | 'cancelled';
  error?: { code: string; safeMessage: string; retryable: boolean };
}
