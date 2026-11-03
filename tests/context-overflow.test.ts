import { AgentRuntime } from '@praxis/agent-runtime';
import { ContextBuilder } from '@praxis/context';
import { PraxisError, type ModelConfig } from '@praxis/contracts';
import { DeepSeekClient, type ModelClient } from '@praxis/model-core';
import { SessionStore, uuid } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import test from 'node:test';

const config: ModelConfig = {
  id: 'fixture',
  revision: 1,
  baseUrl: 'https://provider.invalid',
  model: 'fixture',
  apiKey: 'test-secret',
  contextWindow: 32000,
  maxOutputTokens: 1000,
};
const summary = {
  objective: '继续',
  requirements: [],
  decisions: [],
  completed: [],
  active: [],
  blocked: [],
  files: [],
  executions: [],
  nextActions: [],
  unresolvedQuestions: [],
};
function answer(content: string) {
  return {
    message: { id: uuid(), role: 'assistant' as const, content },
    usage: { input: 100, output: 100 },
    finishReason: 'stop',
  };
}

test('only explicit context overflow codes are classified; ordinary 400 bodies stay private', async () => {
  for (const code of ['context_length_exceeded', 'invalid_request_error']) {
    let calls = 0;
    const model = new DeepSeekClient(async () => {
      calls++;
      return new Response(
        JSON.stringify({ error: { code, message: 'test-secret context length exceeded' } }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      );
    });
    await assert.rejects(
      model.complete({
        messages: [],
        tools: [],
        config,
        purpose: 'agent_step',
        signal: new AbortController().signal,
        onDelta: () => {},
      }),
      { code: code === 'context_length_exceeded' ? 'MODEL_CONTEXT_OVERFLOW' : 'MODEL_HTTP_ERROR' },
    );
    assert.equal(calls, 1);
  }
});

async function fixture(model: ModelClient) {
  const store = new SessionStore(':memory:'),
    session = store.create('owner', 'chat');
  for (let i = 0; i < 4; i++)
    store.message(session.id, {
      id: uuid(),
      role: i % 2 ? 'assistant' : 'user',
      content: 'history '.repeat(100),
    });
  const runtime = new AgentRuntime(store, { model, beginUse: async () => config });
  runtime.prompt('owner', {
    sessionId: session.id,
    requestId: uuid(),
    text: '当前要求',
    mode: 'queue',
  });
  await runtime.wait(session.id);
  return {
    store,
    session,
    runtime,
    async close() {
      await runtime.close();
      store.close();
    },
  };
}

test('a local turn compacts below its normal trigger and retries overflow once with a new view', async () => {
  let calls = 0,
    summaries = 0;
  const f = await fixture({
    async complete(request) {
      if (request.purpose === 'compaction') {
        summaries++;
        return answer(JSON.stringify(summary));
      }
      calls++;
      if (calls === 1) throw new PraxisError('MODEL_CONTEXT_OVERFLOW', '明确溢出');
      assert.ok(request.messages.some((message) => message.content.startsWith('历史摘要')));
      assert.equal(request.messages.at(-1)?.content, '当前要求');
      return answer('完成');
    },
  });
  try {
    assert.equal(f.store.get(f.session.id).status, 'completed');
    assert.equal(calls, 2);
    assert.equal(summaries, 1);
    assert.equal(f.store.context(f.session.id).version, 1);
    assert.equal(f.store.messages(f.session.id).length, 6);
    assert.equal(f.store.latestEvent(f.session.id, 'turn/finished')?.payload.attempts, 3);
  } finally {
    await f.close();
  }
});

test('a second overflow and overflow after published output never start another recovery', async () => {
  for (const partial of [false, true]) {
    let calls = 0,
      summaries = 0;
    const f = await fixture({
      async complete(request) {
        if (request.purpose === 'compaction') {
          summaries++;
          return answer(JSON.stringify(summary));
        }
        calls++;
        if (partial) request.onDelta('已有部分输出');
        throw new PraxisError('MODEL_CONTEXT_OVERFLOW', '明确溢出');
      },
    });
    try {
      assert.equal(f.store.get(f.session.id).status, 'failed');
      assert.equal(calls, partial ? 1 : 2);
      assert.equal(summaries, partial ? 0 : 1);
    } finally {
      await f.close();
    }
  }
});

test('forced compaction never commits a candidate larger than its source view', async () => {
  const store = new SessionStore(':memory:'),
    session = store.create('owner', 'chat');
  store.message(session.id, { id: uuid(), role: 'user', content: 'old' });
  store.message(session.id, { id: uuid(), role: 'assistant', content: 'ok' });
  store.message(session.id, { id: uuid(), role: 'user', content: 'current' });
  const original = store.messages(session.id);
  const builder = new ContextBuilder(store, {
    async complete() {
      return answer(JSON.stringify(summary));
    },
  });
  try {
    await assert.rejects(
      builder.build(session.id, [], [], config, new AbortController().signal, () => {}, true),
      { code: 'COMPACTION_NO_PROGRESS' },
    );
    assert.equal(store.context(session.id).version, 0);
    assert.deepEqual(store.messages(session.id), original);
  } finally {
    store.close();
  }
});
