import { z } from 'zod';
import { modelIdSchema } from './provider.ts';

export const providerModelSchema = z
  .strictObject({
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/),
    model: modelIdSchema,
    contextWindow: z.number().int().min(8192).max(2_000_000),
    maxOutputTokens: z.number().int().min(256).max(393216),
    enabled: z.boolean(),
  })
  .refine((v) => v.maxOutputTokens < v.contextWindow / 2, '最大输出必须小于上下文窗口的一半。');

export type ProviderModel = z.infer<typeof providerModelSchema>;
type ModelSource = Pick<ProviderModel, 'model' | 'contextWindow' | 'maxOutputTokens'> & {
  models?: ProviderModel[] | undefined;
  defaultModelId?: string | undefined;
};

// Lazy compatibility projection: existing rows and selection IDs remain unchanged.
export function providerModels(source: ModelSource): ProviderModel[] {
  return (
    source.models ?? [
      {
        id: 'default',
        model: source.model,
        contextWindow: source.contextWindow,
        maxOutputTokens: source.maxOutputTokens,
        enabled: true,
      },
    ]
  );
}

export function modelSelectionId(
  providerId: string,
  modelId: string,
  defaultModelId = 'default',
): string {
  return modelId === defaultModelId ? providerId : `${providerId}:${modelId}`;
}

export function parseModelSelection(selection: string) {
  const separator = selection.indexOf(':');
  return separator < 0
    ? { providerId: selection, modelId: 'default' }
    : { providerId: selection.slice(0, separator), modelId: selection.slice(separator + 1) };
}

export function providerModelChoices<
  T extends ModelSource & { id: string; name: string; enabled: boolean },
>(providers: T[]) {
  return providers.flatMap((provider) =>
    providerModels(provider).map((model) => ({
      ...model,
      id: modelSelectionId(provider.id, model.id, provider.defaultModelId),
      providerId: provider.id,
      name: `${provider.name} · ${model.model}`,
      enabled: provider.enabled && model.enabled,
    })),
  );
}
