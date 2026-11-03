import {
  modelAdapterSchema,
  modelIdSchema,
  providerBaseUrlSchema,
} from '@praxis/model-core/provider';
import { z } from 'zod';
import type { Encrypted } from './secrets.ts';

export const providerInputSchema = z
  .strictObject({
    name: z.string().min(1).max(100),
    adapter: modelAdapterSchema.optional(),
    model: modelIdSchema,
    baseUrl: providerBaseUrlSchema.default('https://api.deepseek.com'),
    contextWindow: z.number().int().min(8192).max(2_000_000),
    maxOutputTokens: z.number().int().min(256).max(393216),
    enabled: z.boolean().default(true),
  })
  .refine((v) => v.maxOutputTokens < v.contextWindow / 2, 'Output budget too large');

export type ProviderInput = z.infer<typeof providerInputSchema>;

export type ProviderRow = {
  id: string;
  user_id: string;
  revision: number;
  config: ProviderInput;
  encrypted_key: Encrypted;
  enabled: boolean;
};
