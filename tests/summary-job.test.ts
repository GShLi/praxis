import { SummaryJob, budget, estimate, protocolGroups } from '@praxis/context';
import type { Message, ModelConfig } from '@praxis/contracts';
import { DeepSeekClient, type ModelClient } from '@praxis/model-core';
import assert from 'node:assert/strict';
import test from 'node:test';

const config: ModelConfig = {
  id: 'fixture',
  revision: 1,
  model: 'fixture',
  apiKey: 'fixture-key',
  baseUrl: 'https://provider.invalid',
  contextWindow: 8192,
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
const source: Message[][] = [[{ id: 'user', role: 'user', content: '历史需求' }]];
const completion = () => ({
  message: {
    id: crypto.randomUUID(),
    role: 'assistant' as const,
    content: JSON.stringify(summary),
  },
  usage: { input: 100, output: 100 },
  finishReason: 'stop',
});

test('summary cap and turn budget include physical HTTP retries across contractions', async () => {
  let calls = 0,
    charged = 0;
  const client = new DeepSeekClient(async () => {
    calls++;
    if (calls === 6 || calls === 7) return new Response('', { status: 429 });
    return new Response(
      'data: ' +
        JSON.stringify({
          choices: [{ delta: { content: JSON.stringify(summary) }, finish_reason: 'stop' }],
        }) +
        '\n\ndata: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    );
  });
  const job = new SummaryJob(
    client,
    config,
    new AbortController().signal,
    () => {},
    () => {
      charged++;
    },
  );
  for (let i = 0; i < 6; i++) await job.summarize(source);
  assert.equal(calls, 8);
  assert.equal(charged, 8);
  await assert.rejects(job.summarize(source), /过多|上限/);
  assert.equal(calls, 8);
});

test('summary chunks size encoded requests and preserve entire tool exchanges', async () => {
  const groups: Message[][] = Array.from({ length: 10 }, (_, i) => [
    {
      id: `a${i}`,
      role: 'assistant',
      content: '',
      toolCalls: [{ id: `c${i}`, name: 'read', arguments: '{}' }],
    },
    { id: `t${i}`, role: 'tool', toolCallId: `c${i}`, content: '"\\'.repeat(200) },
  ]);
  const observed: string[] = [];
  let calls = 0;
  const client: ModelClient = {
    async complete(request) {
      calls++;
      assert.ok(estimate(request.messages) < budget(config).available);
      assert.deepEqual(request.tools, []);
      const chunk = JSON.parse(request.messages[1]!.content);
      if (chunk[0]?.role) {
        protocolGroups(chunk);
        observed.push(...chunk.map((message: Message) => message.id));
      }
      return completion();
    },
  };
  await new SummaryJob(client, config, new AbortController().signal, () => {}).summarize(groups);
  assert.ok(calls > 1 && calls <= 8);
  assert.deepEqual(
    observed,
    groups.flat().map((message) => message.id),
  );
});

test('cancellation during snapshot persistence spends no model request', async () => {
  const controller = new AbortController();
  let calls = 0;
  const client: ModelClient = {
    async complete() {
      calls++;
      return completion();
    },
  };
  const job = new SummaryJob(client, config, controller.signal, async () => {
    await Promise.resolve();
    controller.abort();
  });
  await assert.rejects(job.summarize(source), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('unfit protocol groups and excessive chunk count reject before model I/O', async () => {
  let calls = 0;
  const client: ModelClient = {
    async complete() {
      calls++;
      return completion();
    },
  };
  const job = new SummaryJob(client, config, new AbortController().signal, () => {});
  await assert.rejects(
    job.summarize([[{ id: 'big', role: 'user', content: 'x'.repeat(20000) }]]),
    /协议组/,
  );
  const many: Message[][] = Array.from({ length: 20 }, (_, i) => [
    { id: String(i), role: 'user', content: 'x'.repeat(4000) },
  ]);
  await assert.rejects(job.summarize(many), /过多/);
  assert.equal(calls, 0);
});

test('summary input reserves its actual output cap even when normal generation has a smaller cap', async () => {
  let calls = 0;
  const job = new SummaryJob(
    {
      async complete() {
        calls++;
        return completion();
      },
    },
    { ...config, contextWindow: 16000, maxOutputTokens: 128 },
    new AbortController().signal,
    () => {},
  );
  await assert.rejects(
    job.summarize([[{ id: 'large', role: 'user', content: 'x'.repeat(27000) }]]),
    { code: 'CONTEXT_GROUP_TOO_LARGE' },
  );
  assert.equal(calls, 0);
});
