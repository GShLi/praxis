import {
  modelAdapterSchema,
  modelIdSchema,
  providerBaseUrlSchema,
} from '@praxis/model-core/provider';
import { z } from 'zod';
import { providerModelSchema } from '@praxis/model-core/provider-models';
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
    models: z.array(providerModelSchema).min(1).max(100).optional(),
    defaultModelId: z.string().min(1).max(64).optional(),
  })
  .refine((v) => v.maxOutputTokens < v.contextWindow / 2, 'Output budget too large')
  .refine((v) => {
    if (!v.models) return !v.defaultModelId;
    const primary = v.models.find((m) => m.id === (v.defaultModelId ?? 'default'));
    return (
      primary?.model === v.model &&
      primary.contextWindow === v.contextWindow &&
      primary.maxOutputTokens === v.maxOutputTokens &&
      new Set(v.models.map((m) => m.id)).size === v.models.length &&
      new Set(v.models.map((m) => m.model)).size === v.models.length
    );
  }, '模型 ID 不能重复，且默认模型必须与兼容配置一致。');

export type ProviderInput = z.infer<typeof providerInputSchema>;

export type ProviderRow = {
  id: string;
  user_id: string;
  revision: number;
  config: ProviderInput;
  encrypted_key: Encrypted;
  enabled: boolean;
};

/** Old clients edit the primary model, without permission to erase newer model entries. */
export function preserveProviderModels(
  input: ProviderInput,
  previous: ProviderInput,
): ProviderInput {
  if (input.models || !previous.models) return input;
  const defaultModelId = previous.defaultModelId ?? 'default';
  return providerInputSchema.parse({
    ...input,
    defaultModelId,
    models: previous.models.map((model) =>
      model.id === defaultModelId
        ? {
            ...model,
            model: input.model,
            contextWindow: input.contextWindow,
            maxOutputTokens: input.maxOutputTokens,
          }
        : model,
    ),
  });
}
