import { assert, PraxisError, type ModelConfig } from '@praxis/contracts';
import type { ModelClient, ModelRequest } from '@praxis/model-core';
import { ModelOutputGuard } from '@praxis/model-core';
import { z } from 'zod';
import { hookOperation } from './hook-operation.ts';
import type { ActivePlugin } from './types.ts';

const responseSchema = z
  .strictObject({
    message: z.strictObject({
      id: z.string().min(1).max(128),
      role: z.literal('assistant'),
      content: z.string(),
      reasoning: z.string().optional(),
      toolCalls: z
        .array(
          z.strictObject({
            id: z.string().min(1).max(128),
            name: z.string().min(1).max(128),
            arguments: z.string().max(2 * 1024 * 1024),
          }),
        )
        .max(64)
        .optional(),
    }),
    usage: z.strictObject({
      input: z.number().int().nonnegative(),
      output: z.number().int().nonnegative(),
    }),
    finishReason: z.string().min(1).max(128),
  })
  .transform((value) => {
    const { toolCalls, reasoning, ...message } = value.message;
    return {
      ...value,
      message: {
        ...message,
        ...(toolCalls ? { toolCalls } : {}),
        ...(reasoning !== undefined ? { reasoning } : {}),
      },
    };
  });

/** Resolve once per turn. A missing explicit adapter must never fall back with the same key. */
export function resolvePluginModel(
  plugins: readonly ActivePlugin[],
  config: ModelConfig,
  fallback: ModelClient,
) {
  const adapter = config.adapter ?? 'openai-compatible';
  if (adapter === 'openai-compatible') return { model: fallback, descriptor: { adapter } };
  const [pluginId, providerId, extra] = adapter.split('/');
  const plugin = plugins.find((p) => p.manifest.id === pluginId);
  const client = providerId && !extra ? plugin?.providers.get(providerId) : undefined;
  assert(
    plugin && client,
    'PROVIDER_ADAPTER_UNAVAILABLE',
    '所选模型适配器未安装、未启用或不支持当前模式。',
  );
  return {
    model: new PluginModel(client),
    descriptor: {
      adapter,
      pluginId: plugin.manifest.id,
      pluginVersion: plugin.manifest.version,
      pluginDigest: plugin.digest,
    },
  };
}

class PluginModel implements ModelClient {
  constructor(private client: ModelClient) {}
  async complete(request: ModelRequest) {
    return hookOperation(
      async (signal) => {
        const stream = new ModelOutputGuard(request.config.apiKey, request.onDelta);
        let raw: unknown;
        let received = false;
        try {
          raw = await this.client.complete({
            ...request,
            config: Object.freeze({ ...request.config }),
            signal,
            onDelta: (text) => {
              received ||= text.length > 0;
              if (!signal.aborted) stream.push(text);
            },
          });
        } catch (error) {
          if (signal.aborted) throw signal.reason;
          if (stream.failure) throw stream.failure;
          if (!received && error instanceof PraxisError && error.code === 'MODEL_CONTEXT_OVERFLOW')
            throw new PraxisError('MODEL_CONTEXT_OVERFLOW', '模型适配器报告输入超过上下文窗口。');
          throw new PraxisError('PLUGIN_PROVIDER_FAILED', '插件模型调用失败，请检查适配器配置。');
        }
        signal.throwIfAborted();
        const response = responseSchema.safeParse(raw);
        assert(response.success, 'MODEL_PROTOCOL_ERROR', '插件模型返回了无效响应。');
        stream.validate(response.data);
        stream.finish();
        return response.data;
      },
      request.signal,
      600_000,
    );
  }
}
