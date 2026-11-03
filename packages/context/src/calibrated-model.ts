import { assert, type ModelConfig } from '@praxis/contracts';
import { modelUsageSchema, type ModelClient, type ModelRequest } from '@praxis/model-core';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { estimate } from './tokens.ts';

const recordSchema = z.object({
  schemaVersion: z.literal(1),
  scope: z.string().regex(/^[a-f0-9]{64}$/),
  factor: z.number().finite().min(1).max(Number.MAX_SAFE_INTEGER),
});
export function calibrationScope(config: ModelConfig) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        config.id,
        config.revision,
        config.model,
        config.adapter ?? 'openai-compatible',
      ]),
    )
    .digest('hex');
}

/** Owned by one turn/generation. Successful persistence precedes changes to its estimate. */
export class CalibratedModel implements ModelClient {
  private factor = 1;
  private scope: string;
  constructor(
    private model: ModelClient,
    config: ModelConfig,
    previous: unknown,
    private record: (payload: Record<string, unknown>) => void | Promise<void>,
  ) {
    this.scope = calibrationScope(config);
    if (previous !== undefined) {
      const parsed = recordSchema.safeParse(previous);
      assert(
        parsed.success && parsed.data.scope === this.scope,
        'INVALID_CALIBRATION',
        '上下文校准记录无效。',
      );
      this.factor = parsed.data.factor;
    }
  }
  readonly estimate = (value: unknown) => Math.ceil(estimate(value) * this.factor);
  snapshot(value: unknown) {
    return {
      algorithm: 'utf8-v1',
      provenance: 'estimated',
      scope: this.scope,
      baseline: estimate(value),
      tokens: this.estimate(value),
      factor: this.factor,
    };
  }
  async complete(request: ModelRequest) {
    request.signal.throwIfAborted();
    assert(
      calibrationScope(request.config) === this.scope,
      'INVALID_CALIBRATION',
      '请求模型与校准范围不匹配。',
    );
    const inputEstimate = this.snapshot([request.messages, request.tools]);
    const response = await this.model.complete(request);
    request.signal.throwIfAborted();
    const parsed = modelUsageSchema.safeParse(response.usage);
    assert(parsed.success, 'MODEL_PROTOCOL_ERROR', '模型用量数据结构无效。');
    const usage = parsed.data;
    const reported = usage.provenance !== 'estimated' ? usage.input : null;
    const factor =
      reported !== null && reported > 0
        ? Math.max(this.factor, (reported / inputEstimate.baseline) * 1.1)
        : this.factor;
    await this.record({
      schemaVersion: 1,
      scope: this.scope,
      factor,
      inputEstimate,
      usage,
      requestId: request.requestId ?? null,
      purpose: request.purpose,
    });
    request.signal.throwIfAborted();
    this.factor = factor;
    return response;
  }
}
