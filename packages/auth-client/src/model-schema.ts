import { modelAdapterSchema, providerBaseUrlSchema } from '@praxis/model-core/provider';
import { z } from 'zod';

export const modelSchema = z
  .strictObject({
    id: z.string(),
    adapter: modelAdapterSchema.optional(),
    revision: z.number().int(),
    baseUrl: providerBaseUrlSchema,
    model: z.string(),
    apiKey: z.string(),
    contextWindow: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
  })
  .transform(({ adapter, ...config }) => ({ ...config, ...(adapter ? { adapter } : {}) }));
