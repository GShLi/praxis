import { assert, PraxisError, type ModelConfig } from '@praxis/contracts';
import type { ModelClient, ModelRequest } from '@praxis/model-core';
import { z } from 'zod';
import { hookOperation } from './hook-operation.ts';
import type { ActivePlugin } from './types.ts';
import { ProviderStream } from './provider-stream.ts';

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
        const stream = new ProviderStream(request.config.apiKey, request.onDelta);
        let raw: unknown;
        try {
          raw = await this.client.complete({
            ...request,
            config: Object.freeze({ ...request.config }),
            signal,
            onDelta: (text) => {
              if (!signal.aborted) stream.push(text);
            },
          });
        } catch {
          if (signal.aborted) throw signal.reason;
          if (stream.failure) throw stream.failure;
          throw new PraxisError('PLUGIN_PROVIDER_FAILED', '插件模型调用失败，请检查适配器配置。');
        }
        signal.throwIfAborted();
        const response = responseSchema.safeParse(raw);
        assert(response.success, 'MODEL_PROTOCOL_ERROR', '插件模型返回了无效响应。');
        const encoded = JSON.stringify(response.data);
        assert(
          Buffer.byteLength(encoded) <= 2 * 1024 * 1024,
          'MODEL_RESPONSE_LIMIT',
          '模型输出超过限制。',
        );
        assert(
          !request.config.apiKey ||
            !encoded.includes(JSON.stringify(request.config.apiKey).slice(1, -1)),
          'MODEL_SECRET_EXPOSURE',
          '模型输出包含受保护凭据，已拒绝显示。',
        );
        stream.finish();
        return response.data;
      },
      request.signal,
      600_000,
    );
  }
}
