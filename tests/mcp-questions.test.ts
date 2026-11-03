import { AgentRuntime } from '@praxis/agent-runtime';
import { uuid } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mcpFixture } from './fixtures/mcp-server.ts';

test('interactive MCP fields use runtime questions and validate before durable answer or continuation', async () => {
  const f = await mcpFixture();
  await f.enable();
  f.remote.inputRequired = true;
  f.remote.form = {
    type: 'object',
    properties: {
      city: { type: 'string' },
      enabled: { type: 'boolean' },
      count: { type: 'integer', minimum: 1 },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['city', 'enabled', 'count', 'tags'],
  };
  let steps = 0,
    questions = 0,
    approvals = 0,
    invalidRejected = false;
  const runtime = new AgentRuntime(f.store, {
    interactive: true,
    beginUse: async () => ({
      id: 'fixture',
      revision: 1,
      baseUrl: 'https://example.invalid',
      apiKey: 'fixture-model-secret',
      model: 'fixture',
      contextWindow: 32000,
      maxOutputTokens: 1000,
    }),
    toolExtension: (session, config, approve, signal, ask) =>
      f.mcp.create(session, config.contextWindow, approve, signal, [config.apiKey], ask),
    model: {
      async complete(request) {
        steps++;
        const name =
          steps === 1
            ? 'mcp_discover_tools'
            : steps === 2
              ? request.tools.find((t) => t.modelName.startsWith('mcp__'))!.modelName
              : undefined;
        const args = steps === 1 ? { serverId: f.config.id } : { text: 'hello' };
        return {
          message: {
            id: uuid(),
            role: 'assistant',
            content: '',
            ...(name ? { toolCalls: [{ id: uuid(), name, arguments: JSON.stringify(args) }] } : {}),
          },
          usage: { input: 0, output: 0 },
          finishReason: name ? 'tool_calls' : 'stop',
        };
      },
    },
  });
  f.store.on('event', (event) => {
    if (event.type === 'approval/requested') {
      approvals++;
      const value = runtime.approvals.snapshot(f.session.id)!;
      runtime.approvals.respond('alice', {
        sessionId: f.session.id,
        turnId: value.turnId,
        approvalId: value.approvalId,
        requestHash: value.requestHash,
        decision: 'approve-once',
      });
    }
    if (event.type === 'question/asked') {
      questions++;
      const value = runtime.pendingQuestion(f.session.id)!;
      const base = { sessionId: f.session.id, turnId: value.turnId, questionId: value.questionId };
      const answers = value.questions.map((q, index) => ({
        id: q.id,
        text: ['Shanghai', 'true', '2', '["a","b"]'][index],
        skipped: false,
      }));
      try {
        runtime.answer('alice', {
          ...base,
          answers: answers.map((a, index) => (index === 2 ? { ...a, text: 'not-a-number' } : a)),
        });
      } catch {
        invalidRejected = !f.store.events(f.session.id).some((e) => e.type === 'question/answered');
      }
      runtime.answer('alice', { ...base, answers });
    }
  });
  try {
    runtime.prompt('alice', {
      sessionId: f.session.id,
      requestId: uuid(),
      text: 'test form',
      mode: 'queue',
    });
    await runtime.wait(f.session.id);
    assert.equal(f.store.get(f.session.id).status, 'completed');
    assert.equal(questions, 1);
    assert.equal(approvals, 2);
    assert.equal(invalidRejected, true);
    const second = f.requests.filter((r) => r.method === 'tools/call')[1];
    assert.deepEqual(second?.params.inputResponses, {
      details: {
        action: 'accept',
        content: { city: 'Shanghai', enabled: true, count: 2, tags: ['a', 'b'] },
      },
    });
  } finally {
    await runtime.close();
    await f.close();
  }
});
