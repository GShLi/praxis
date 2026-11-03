import { CalibratedModel, calibrationScope, estimate } from '@praxis/context';
import type { ModelConfig } from '@praxis/contracts';
import type { ModelClient, ModelRequest } from '@praxis/model-core';
import assert from 'node:assert/strict';
import test from 'node:test';

const config: ModelConfig = {
  id: 'fixture',
  revision: 1,
  model: 'fixture',
  baseUrl: 'https://provider.invalid',
  apiKey: 'calibration-test-secret',
  contextWindow: 16000,
  maxOutputTokens: 1000,
};
const request: ModelRequest = {
  config,
  requestId: crypto.randomUUID(),
  messages: [{ id: 'u', role: 'user', content: 'hello' }],
  tools: [],
  purpose: 'chat_generation',
  signal: new AbortController().signal,
  onDelta: () => {},
};
const baseline = estimate([request.messages, request.tools]);
function client(
  input: number | null,
  provenance: 'reported' | 'estimated' = 'reported',
): ModelClient {
  return {
    async complete() {
      return {
        message: { id: 'a', role: 'assistant', content: 'ok' },
        finishReason: 'stop',
        usage: { input, output: null, cacheRead: input, provenance },
      };
    },
  };
}

test('calibration persists reported total input and never decreases its multiplier', async () => {
  const records: Record<string, unknown>[] = [];
  const model = new CalibratedModel(client(baseline * 2), config, undefined, (record) => {
    records.push(record);
  });
  assert.equal(model.estimate([request.messages, request.tools]), baseline);
  await model.complete(request);
  assert.equal(model.estimate([request.messages, request.tools]), Math.ceil(baseline * 2.2));
  const restored = new CalibratedModel(client(1), config, records[0], (record) => {
    records.push(record);
  });
  await restored.complete(request);
  assert.equal(restored.estimate([request.messages, request.tools]), Math.ceil(baseline * 2.2));
  assert.equal(records[0]!.requestId, request.requestId);
  assert.ok(!JSON.stringify(records).includes(config.apiKey));
  assert.notEqual(calibrationScope(config), calibrationScope({ ...config, revision: 2 }));
  assert.notEqual(calibrationScope(config), calibrationScope({ ...config, model: 'other' }));
  assert.throws(
    () => new CalibratedModel(client(1), { ...config, revision: 2 }, records[0], () => {}),
    /校准/,
  );
});

test('unknown or estimated counts cannot calibrate; failed persistence and cancellation cannot publish a factor', async () => {
  for (const usage of [client(null), client(baseline * 10, 'estimated')]) {
    const model = new CalibratedModel(usage, config, undefined, () => {});
    await model.complete(request);
    assert.equal(model.estimate([request.messages, request.tools]), baseline);
  }
  const failed = new CalibratedModel(client(baseline * 2), config, undefined, () => {
    throw new Error('disk failure');
  });
  await assert.rejects(failed.complete(request), /disk failure/);
  assert.equal(failed.estimate([request.messages, request.tools]), baseline);
  const controller = new AbortController();
  let recorded = false;
  const cancelled = new CalibratedModel(
    {
      async complete(r) {
        controller.abort();
        return client(baseline * 2).complete(r);
      },
    },
    config,
    undefined,
    () => {
      recorded = true;
    },
  );
  await assert.rejects(cancelled.complete({ ...request, signal: controller.signal }), {
    name: 'AbortError',
  });
  assert.equal(recorded, false);
});
