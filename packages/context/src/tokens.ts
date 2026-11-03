import type { ModelConfig } from '@praxis/contracts';
import { assert } from '@praxis/contracts';

// UTF-8 heuristic, not a tokenizer guarantee. CalibratedModel only increases this baseline.
export const estimate = (value: unknown) =>
  Math.ceil(Buffer.byteLength(JSON.stringify(value)) / 2) + 16;

export function budget(config: ModelConfig) {
  const available =
    config.contextWindow -
    config.maxOutputTokens -
    Math.max(1024, Math.ceil(0.05 * config.contextWindow));
  assert(available > 2560, 'CONTEXT_CONFIGURATION', '模型窗口不足，请检查窗口和输出上限。');
  return {
    available,
    trigger: Math.ceil(0.8 * available),
    target: Math.floor(0.6 * available),
    retain: Math.min(12_000, Math.floor(0.2 * available)),
    summary: Math.min(4096, Math.floor(0.1 * available)),
  };
}
