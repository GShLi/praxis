import { DeepSeekClient } from '@praxis/model-core';
import { AgentRuntime } from '@praxis/agent-runtime';
import { SessionStore, uuid } from '@praxis/storage-local';
import type { ModelConfig } from '@praxis/contracts';
import assert from 'node:assert/strict';
import test from 'node:test';

const config: ModelConfig = {
  id: 'fixture',
  revision: 1,
  baseUrl: 'https://provider.invalid',
  model: 'fixture',
  apiKey: 'private-"\\-fixture-key',
  contextWindow: 16000,
  maxOutputTokens: 1000,
};
function client(deltas: object[], reason = 'stop') {
  return new DeepSeekClient(
    async () =>
      new Response(
        deltas
          .map((delta) => 'data: ' + JSON.stringify({ choices: [{ index: 0, delta }] }) + '\n\n')
          .join('') +
          'data: ' +
          JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: reason }] }) +
          '\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  );
}
const request = () => ({
  messages: [],
  tools: [],
  config,
  purpose: 'agent_step' as const,
  signal: new AbortController().signal,
  onDelta: (_text: string) => {},
});

test('built-in model rejects a credential spanning multiple text deltas before displaying it', async () => {
  let displayed = '';
  const provider = client([
    { content: '正常前文 ' },
    { content: config.apiKey.slice(0, 5) },
    { content: config.apiKey.slice(5, 11) },
    { content: config.apiKey.slice(11) },
  ]);
  await assert.rejects(
    provider.complete({
      ...request(),
      onDelta: (text) => {
        displayed += text;
      },
    }),
    { code: 'MODEL_SECRET_EXPOSURE' },
  );
  assert.ok(!displayed.includes(config.apiKey));
});

test('reasoning and JSON-encoded tool arguments cannot carry a managed credential into persistence', async () => {
  await assert.rejects(client([{ reasoning_content: config.apiKey }]).complete(request()), {
    code: 'MODEL_SECRET_EXPOSURE',
  });
  const arguments_ = JSON.stringify({ nested: { token: config.apiKey } });
  const provider = client(
    [
      {
        tool_calls: [
          { index: 0, id: 'call', function: { name: 'fs_write', arguments: arguments_ } },
        ],
      },
    ],
    'tool_calls',
  );
  await assert.rejects(provider.complete(request()), { code: 'MODEL_SECRET_EXPOSURE' });
});

test('safe short and Unicode output flushes completely without losing surrogate pairs', async () => {
  let displayed = '';
  const text = '短句😀完成';
  const provider = client(Array.from({ length: text.length }, (_, i) => ({ content: text[i] })));
  const response = await provider.complete({
    ...request(),
    onDelta: (delta) => {
      displayed += delta;
    },
  });
  assert.equal(response.message.content, text);
  assert.equal(displayed, text);
});

test('rejected model credentials never reach Session events, history or published deltas', async () => {
  const store = new SessionStore(':memory:');
  const session = store.create('owner', 'chat');
  const runtime = new AgentRuntime(store, {
    beginUse: async () => config,
    model: client([
      { content: '回复：' },
      { content: config.apiKey.slice(0, 8) },
      { content: config.apiKey.slice(8) },
    ]),
  });
  const deltas: unknown[] = [];
  runtime.on('delta', (delta) => deltas.push(delta));
  try {
    runtime.prompt('owner', {
      sessionId: session.id,
      requestId: uuid(),
      text: 'hello',
      mode: 'queue',
    });
    await runtime.wait(session.id);
    assert.equal(store.get(session.id).status, 'failed');
    const records = JSON.stringify({
      events: store.events(session.id),
      messages: store.messages(session.id),
      deltas,
    });
    assert.ok(!records.includes(JSON.stringify(config.apiKey).slice(1, -1)));
    assert.equal(
      store.latestEvent(session.id, 'turn/error')?.payload.code,
      'MODEL_SECRET_EXPOSURE',
    );
    assert.equal(
      store.messages(session.id).filter((message) => message.role === 'assistant').length,
      0,
    );
  } finally {
    await runtime.close();
    store.close();
  }
});
