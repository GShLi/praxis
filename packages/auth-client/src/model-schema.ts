import { providerBaseUrlSchema } from '@praxis/model-core/provider';
import { z } from 'zod';

export const modelSchema = z.strictObject({
  id: z.string(),
  revision: z.number().int(),
  baseUrl: providerBaseUrlSchema,
  model: z.string(),
  apiKey: z.string(),
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
});
