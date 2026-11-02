import { z } from 'zod';

export const requestSchema = z.strictObject({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().min(1),
  params: z.unknown().optional(),
});

export type Handler = (method: string, params: unknown) => Promise<unknown> | unknown;
