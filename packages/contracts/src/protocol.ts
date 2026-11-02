import { z } from 'zod';

export const PROTOCOL = { major: 1, minor: 0 } as const;

export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

export const idSchema = z.string().min(1).max(128);

export const textSchema = z
  .string()
  .min(1)
  .refine((s) => new TextEncoder().encode(s).length <= 256 * 1024, 'Text exceeds 256 KiB');

export const initializeSchema = z.strictObject({
  protocolMajor: z.number().int(),
  protocolMinor: z.number().int().nonnegative(),
  clientInstanceId: idSchema,
  clientKind: z.enum(['cli', 'desktop']),
  nonce: z.string().min(16).max(256),
});

export const promptSchema = z.strictObject({
  sessionId: idSchema,
  requestId: idSchema,
  mode: z.enum(['queue', 'steer']).default('queue'),
  text: textSchema,
  expectedTurnId: idSchema.optional(),
});

export type Prompt = z.infer<typeof promptSchema>;

export const permissionSchema = z.strictObject({
  mode: z.enum(['read-only', 'workspace-write']).default('workspace-write'),
  approval: z.enum(['ask', 'never']).default('ask'),
  revision: z.number().int().nonnegative().default(0),
});

export type Permission = z.infer<typeof permissionSchema>;
