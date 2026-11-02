import { AgentRuntime } from '@praxis/agent-runtime';
import type { ModelConfig, ToolCall, ToolResult } from '@praxis/contracts';
import { modelToolName } from '@praxis/mcp-core';
import { uuid } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mcpFixture } from './fixtures/mcp-server.ts';

const config: ModelConfig = {
  id: 'fixture',
  revision: 1,
  baseUrl: 'https://model.invalid',
  model: 'fixture',
  apiKey: 'fixture',
  contextWindow: 32000,
  maxOutputTokens: 1000,
};
const call = (name: string, args: object): ToolCall => ({
  id: uuid(),
  name,
  arguments: JSON.stringify(args),
});

test(
  'Agent uses MCP only after next-step selection and single-use approval over real HTTP',
  { timeout: 5000 },
  async () => {
    const env = await mcpFixture();
    let steps = 0;
    const remoteName = modelToolName(env.config.id, 'echo', 'echo');
    const runtime = new AgentRuntime(env.store, {
      interactive: true,
      beginUse: async () => config,
      toolExtension: (session, config, approve, signal) =>
        env.mcp.create(session, config.contextWindow, approve, signal),
      model: {
        async complete(request) {
          steps++;
          assert.equal(
            request.tools.some((t) => t.modelName === remoteName),
            steps > 1,
          );
          const calls =
            steps === 1
              ? [
                  call('mcp_discover_tools', { serverId: env.config.id }),
                  call(remoteName, { text: 'too soon' }),
                ]
              : steps === 2
                ? [call(remoteName, { text: '猫' })]
                : [];
          return {
            message: { id: uuid(), role: 'assistant', content: '', toolCalls: calls },
            usage: { input: 1, output: 1 },
            finishReason: calls.length ? 'tool_calls' : 'stop',
          };
        },
      },
    });
    env.store.on('event', (event) => {
      if (event.type !== 'approval/requested') return;
      const approval = runtime.approvals.snapshot(env.session.id)!;
      runtime.approvals.respond('alice', {
        sessionId: env.session.id,
        turnId: approval.turnId,
        approvalId: approval.approvalId,
        requestHash: approval.requestHash,
        decision: 'approve-once',
      });
    });
    try {
      await env.enable();
      runtime.prompt('alice', { sessionId: env.session.id, requestId: uuid(), text: 'echo 猫' });
      await runtime.wait(env.session.id);
      assert.equal(env.store.get(env.session.id).status, 'completed');
      const events = env.store.events(env.session.id);
      const results = events
        .filter((e) => e.type === 'tool/result')
        .map((e) => e.payload.result as ToolResult);
      assert.equal(results.length, 3);
      assert.equal(results[0]?.status, 'succeeded');
      assert.equal(results[1]?.error?.code, 'TOOL_NOT_AVAILABLE');
      assert.equal(results[2]?.status, 'succeeded');
      assert.equal(results[2]?.effectState, 'unknown');
      assert.equal((results[2]?.data as { structuredContent: unknown }).structuredContent, false);
      const calls = env.requests.filter((r) => r.method === 'tools/call');
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.headers['mcp-param-text'], '=?base64?54yr?=');
      assert.equal(events.filter((e) => e.type === 'approval/consumed').length, 1);
      assert.equal(events.filter((e) => e.type === 'mcp/toolset-snapshot').length, 3);
      assert.equal(events.filter((e) => e.type === 'mcp/dispatch').length, 1);
    } finally {
      await runtime.close();
      await env.close();
    }
  },
);

test('MCP enable requires a successful check of the exact configuration revision', async () => {
  const env = await mcpFixture();
  try {
    await assert.rejects(env.maintenance.enable(env.config.id, 1, 1), {
      code: 'MCP_TEST_REQUIRED',
    });
    await env.maintenance.test(env.config.id, 1);
    await env.configs.upsert({ ...env.config, displayName: 'changed' }, 1, 1);
    await assert.rejects(env.maintenance.enable(env.config.id, 2, 2), {
      code: 'MCP_TEST_REQUIRED',
    });
    await env.enable();
    assert.equal((await env.configs.file.read()).value[0]?.enabled, true);
    assert.equal(env.requests.filter((r) => r.method === 'tools/call').length, 0);
  } finally {
    await env.close();
  }
});

test('MCP rejects Chat scopes and omits bridge tools that exceed the schema budget', async () => {
  const env = await mcpFixture();
  try {
    await env.enable();
    env.requests.length = 0;
    const signal = new AbortController().signal;
    const approve = async () => () => {};
    const chat = env.store.create('alice', 'chat');
    await assert.rejects(env.mcp.create(chat, 32000, approve, signal), { code: 'MCP_UNAVAILABLE' });
    const extension = await env.mcp.create(env.session, 100, approve, signal);
    try {
      assert.deepEqual(extension.boundary(), []);
    } finally {
      await extension.close();
    }
    assert.equal(env.requests.length, 0);
    const event = env.store.events(env.session.id).find((e) => e.type === 'mcp/toolset-snapshot');
    assert.equal(event?.payload.reason, 'MCP_SCHEMA_BUDGET');
  } finally {
    await env.close();
  }
});
