import { z } from 'zod';
import { idSchema } from './protocol.ts';

export const userCommandSchema = z
  .strictObject({
    sessionId: idSchema,
    requestId: idSchema,
    pluginId: z
      .string()
      .max(100)
      .regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/),
    name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    arguments: z.record(z.string(), z.json()),
  })
  .refine(
    (value) => new TextEncoder().encode(JSON.stringify(value)).length <= 128 * 1024,
    '命令参数超过 128 KiB。',
  );
export type UserCommand = z.infer<typeof userCommandSchema>;
