import { ContextBuilder, protocolGroups } from '@praxis/context';
import type { Message, ModelConfig } from '@praxis/contracts';
import type { ModelClient } from '@praxis/model-core';
import { DeepSeekClient } from '@praxis/model-core';
import { SessionStore, uuid } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import test from 'node:test';

const config: ModelConfig = {
  id: 'fixture',
  revision: 1,
  baseUrl: 'https://provider.invalid',
  model: 'fixture',
  apiKey: 'never-persist-this-test-secret',
  contextWindow: 16000,
  maxOutputTokens: 1000,
};
const summary = {
  objective: '继续当前任务',
  requirements: [],
  decisions: [],
  completed: [],
  active: ['剩余工作'],
  blocked: [],
  files: [],
  executions: [],
  nextActions: ['继续'],
  unresolvedQuestions: [],
};
const summarizer: ModelClient = {
  async complete(request) {
    assert.equal(request.tools.length, 0);
    return {
      message: { id: uuid(), role: 'assistant', content: JSON.stringify(summary) },
      usage: { input: 0, output: 0 },
      finishReason: 'stop',
    };
  },
};
function history(store: SessionStore, id: string) {
  for (let i = 0; i < 12; i++) {
    store.message(id, {
      id: uuid(),
      role: i % 2 ? 'assistant' : 'user',
      content: `${i}:` + 'historical detail '.repeat(130),
    });
  }
  store.message(id, { id: uuid(), role: 'user', content: '当前用户要求必须保留原文' });
}
test('repeated compaction versions preserve raw history and retain latest input', async () => {
  const store = new SessionStore(':memory:');
  const session = store.create('u', 'chat');
  const context = new ContextBuilder(store, summarizer);
  try {
    history(store, session.id);
    const original = store.messages(session.id);
    const fixed: Message[] = [{ id: 'system', role: 'system', content: 'stable rules' }];
    const first = await context.build(
      session.id,
      fixed,
      [],
      config,
      new AbortController().signal,
      () => {},
    );
    assert.ok(store.context(session.id).version >= 1);
    assert.equal(first.at(-1)!.content, '当前用户要求必须保留原文');
    assert.deepEqual(store.messages(session.id), original);
    const version = store.context(session.id).version;
    history(store, session.id);
    const second = await context.build(
      session.id,
      fixed,
      [],
      config,
      new AbortController().signal,
      () => {},
    );
    assert.ok(store.context(session.id).version > version);
    assert.equal(store.messages(session.id).length, original.length * 2);
    assert.equal(second.filter((m) => m.content.startsWith('历史摘要')).length, 1);
    assert.doesNotThrow(() => protocolGroups(second));
  } finally {
    store.close();
  }
});
test('invalid or cancelled summary never changes effective context', async () => {
  const store = new SessionStore(':memory:');
  const session = store.create('u', 'chat');
  history(store, session.id);
  try {
    const context = new ContextBuilder(store, {
      async complete() {
        return {
          message: { id: uuid(), role: 'assistant', content: 'not json' },
          usage: { input: 0, output: 0 },
          finishReason: 'stop',
        };
      },
    });
    await assert.rejects(
      context.build(session.id, [], [], config, new AbortController().signal, () => {}),
      /摘要/,
    );
    assert.equal(store.context(session.id).version, 0);
  } finally {
    store.close();
  }
});
test('protocol grouping rejects incorrect tool identities even when counts match', () => {
  assert.throws(() =>
    protocolGroups([
      {
        id: 'a',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'one', name: 'test', arguments: '{}' }],
      },
      { id: 'r', role: 'tool', toolCallId: 'other', content: 'ok' },
    ]),
  );
});
function stream(lines: string[]) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const data = new TextEncoder().encode(lines.join('\n') + '\n');
        for (let i = 0; i < data.length; i += 7) controller.enqueue(data.slice(i, i + 7));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
test('DeepSeek assembles UTF-8 and tool arguments only after full SSE completion', async () => {
  let body = '';
  const model = new DeepSeekClient((async (_url, options) => {
    body = String(options?.body);
    return stream([
      'data: ' +
        JSON.stringify({
          choices: [
            {
              index: 0,
              delta: {
                content: '你好',
                tool_calls: [
                  { index: 0, id: 'c1', function: { name: 'fs_read', arguments: '{"pa' } },
                ],
              },
            },
          ],
        }),
      'data: ' +
        JSON.stringify({
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a"}' } }] },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
      'data: [DONE]',
    ]);
  }) as typeof fetch);
  let text = '';
  const response = await model.complete({
    messages: [{ id: 'u', role: 'user', content: 'read' }],
    tools: [],
    config,
    purpose: 'agent_step',
    signal: new AbortController().signal,
    onDelta: (delta) => {
      text += delta;
    },
  });
  assert.equal(text, '你好');
  assert.deepEqual(JSON.parse(response.message.toolCalls![0]!.arguments), { path: 'a' });
  assert.equal(response.usage.input, 10);
  assert.ok(!body.includes(config.apiKey));
});
test('truncated streams never become complete tool calls and are not retried', async () => {
  let calls = 0;
  const model = new DeepSeekClient((async () => {
    calls++;
    return stream([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"fs_write","arguments":"{"}}]}}]}',
    ]);
  }) as typeof fetch);
  await assert.rejects(
    model.complete({
      messages: [],
      tools: [],
      config,
      purpose: 'agent_step',
      signal: new AbortController().signal,
      onDelta: () => {},
    }),
    /未完整结束/,
  );
  assert.equal(calls, 1);
});
