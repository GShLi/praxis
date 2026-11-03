import { DeepSeekClient, type ModelRequest } from '@praxis/model-core';
import { projectDiagnosticEvent } from '@praxis/diagnostics';
import assert from 'node:assert/strict';
import test from 'node:test';

const request: ModelRequest = {
  config: {
    id: 'fixture',
    revision: 1,
    model: 'fixture',
    baseUrl: 'https://provider.invalid',
    apiKey: 'usage-test-secret',
    contextWindow: 16000,
    maxOutputTokens: 1000,
  },
  messages: [],
  tools: [],
  purpose: 'chat_generation',
  signal: new AbortController().signal,
  onDelta: () => {},
};
async function complete(usage: unknown[]) {
  const client = new DeepSeekClient(
    async () =>
      new Response(
        [
          ...usage.map((value) => 'data: ' + JSON.stringify({ usage: value, choices: [] })),
          'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}',
          'data: [DONE]',
          '',
        ].join('\n'),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  );
  return client.complete(request);
}

test('usage retains cumulative provider counts without summing repeats or subtracting cache hits', async () => {
  const raw = {
    prompt_tokens: 1000,
    completion_tokens: 200,
    total_tokens: 1200,
    prompt_cache_hit_tokens: 900,
    prompt_cache_miss_tokens: 100,
    prompt_tokens_details: { cached_tokens: 900 },
    completion_tokens_details: { reasoning_tokens: 150 },
  };
  const response = await complete([
    null,
    { ...raw, unsafe_text: request.config.apiKey },
    raw,
    null,
  ]);
  assert.deepEqual(response.usage, {
    input: 1000,
    output: 200,
    cacheRead: 900,
    cacheMiss: 100,
    reasoning: 150,
    provenance: 'reported',
    raw,
  });
});

test('missing usage is unknown and partial snapshots do not invent zero tokens', async () => {
  const absent = await complete([null]);
  assert.equal(absent.usage.input, null);
  assert.equal(absent.usage.output, null);
  const partial = await complete([
    { prompt_tokens: 20, completion_tokens: 10 },
    { prompt_tokens: 30 },
  ]);
  assert.equal(partial.usage.input, 30);
  assert.equal(partial.usage.output, null);
  assert.deepEqual(partial.usage.raw, { prompt_tokens: 30 });
});

test('unknown usage does not discard the diagnostic event', () => {
  const event = projectDiagnosticEvent({
    eventId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    seq: 1,
    schemaVersion: 1,
    type: 'step/finished',
    source: 'model',
    timestamp: new Date().toISOString(),
    payload: { usage: { input: null, output: 20, raw: { secret: 'excluded' } } },
  });
  assert.ok(event);
  assert.equal(event.outputTokens, 20);
  assert.equal(event.inputTokens, undefined);
  assert.ok(!JSON.stringify(event).includes('excluded'));
});

test('invalid reported counters fail the model protocol', async () => {
  for (const usage of [{ prompt_tokens: -1 }, { completion_tokens: 0.5 }, { prompt_tokens: 1e30 }])
    await assert.rejects(complete([usage]), { code: 'MODEL_PROTOCOL_ERROR' });
});
