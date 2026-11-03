import { completeWithContextRecovery } from '@praxis/context';
import { PraxisError } from '@praxis/contracts';
import { DeepSeekClient, type ModelRequest } from '@praxis/model-core';
import assert from 'node:assert/strict';
import test from 'node:test';

function request(signal = new AbortController().signal): ModelRequest {
  return {
    messages: [],
    tools: [],
    purpose: 'agent_step',
    signal,
    onDelta: () => {},
    config: {
      id: 'fixture',
      revision: 1,
      baseUrl: 'https://provider.invalid',
      model: 'fixture',
      apiKey: 'fixture-private',
      contextWindow: 16000,
      maxOutputTokens: 1000,
    },
  };
}
test('overflow classification rejects oversized, malformed or non-JSON error bodies and releases them', async () => {
  for (const [body, contentType] of [
    [
      '{"error":{"code":"context_length_exceeded","message":"' + 'x'.repeat(16384) + '"}}',
      'application/json',
    ],
    ['{"error":{"code":"context_length_exceeded"}', 'application/json'],
    ['{"error":{"code":"context_length_exceeded"}}', 'text/html'],
  ]) {
    const response = new Response(body, { status: 400, headers: { 'content-type': contentType! } });
    const model = new DeepSeekClient(async () => response);
    await assert.rejects(model.complete(request()), { code: 'MODEL_HTTP_ERROR' });
    assert.equal(response.body?.locked, false);
  }
});

test('cancellation interrupts reading an unfinished error body without exposing its text', async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  );
  const controller = new AbortController();
  const model = new DeepSeekClient(async () => response);
  const pending = model.complete(request(controller.signal));
  const timer = setTimeout(() => controller.abort(), 10);
  try {
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(cancelled, true);
    assert.equal(response.body?.locked, false);
  } finally {
    clearTimeout(timer);
  }
});

test('overflow recovery rejects an unchanged view and does not recover general failures', async () => {
  for (const code of ['MODEL_CONTEXT_OVERFLOW', 'MODEL_HTTP_ERROR', 'MODEL_INCOMPLETE']) {
    let calls = 0,
      prepares = 0;
    await assert.rejects(
      completeWithContextRecovery(
        {
          async complete() {
            calls++;
            throw new PraxisError(code, 'fixture failure');
          },
        },
        async () => {
          prepares++;
          return { request: request(), contextVersion: 1 };
        },
      ),
      { code: code === 'MODEL_CONTEXT_OVERFLOW' ? 'COMPACTION_NO_PROGRESS' : code },
    );
    assert.equal(calls, 1);
    assert.equal(prepares, code === 'MODEL_CONTEXT_OVERFLOW' ? 2 : 1);
  }
});
