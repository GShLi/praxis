import type { ToolResult } from '@praxis/contracts';
import { modelToolName } from '@praxis/mcp-core';
import { uuid } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mcpFixture } from './fixtures/mcp-server.ts';

function result(name: string): ToolResult {
  return {
    callId: uuid(),
    toolId: name,
    toolVersion: 1,
    status: 'succeeded',
    effectState: 'none',
    artifactIds: [],
    truncated: false,
    durationMs: 0,
  };
}

test('an explicitly empty workspace MCP binding exposes no remote tools and sends no requests', async () => {
  const env = await mcpFixture();
  try {
    await env.enable();
    env.requests.length = 0;
    const tools = await env.mcp.create(
      env.session,
      32000,
      async () => () => {},
      new AbortController().signal,
      [],
      undefined,
      { servers: [] },
    );
    try {
      assert.deepEqual(tools.boundary(), []);
    } finally {
      await tools.close();
    }
    assert.equal(env.requests.length, 0);
  } finally {
    await env.close();
  }
});

test('workspace MCP binding cannot enable an unconfirmed connection or import an unknown server', async () => {
  const env = await mcpFixture();
  const signal = new AbortController().signal;
  try {
    for (const serverId of [env.config.id, uuid()])
      await assert.rejects(
        env.mcp.create(env.session, 32000, async () => () => {}, signal, [], undefined, {
          servers: [{ serverId }],
        }),
        { code: 'WORKSPACE_MCP_UNAVAILABLE' },
      );
    assert.equal(env.requests.length, 0);
  } finally {
    await env.close();
  }
});

test('workspace tool allowlist is immutable and keeps the original catalog identity for dispatch', async () => {
  const env = await mcpFixture();
  let approvals = 0;
  try {
    await env.enable();
    env.requests.length = 0;
    const binding = { servers: [{ serverId: env.config.id, tools: ['echo'] }] };
    const signal = new AbortController().signal;
    const tools = await env.mcp.create(
      env.session,
      32000,
      async () => {
        approvals++;
        return () => {};
      },
      signal,
      [],
      undefined,
      binding,
    );
    binding.servers[0]!.tools.length = 0;
    try {
      tools.boundary();
      const discovered = result('mcp_discover_tools');
      await tools.execute('mcp_discover_tools', { serverId: env.config.id }, signal, discovered);
      const name = modelToolName(env.config.id, 'echo', 'echo');
      assert.ok(tools.boundary().some((tool) => tool.modelName === name));
      const invoked = result(name);
      await tools.execute(name, { text: 'allowed' }, signal, invoked);
      assert.equal(invoked.status, 'succeeded');
      assert.equal(approvals, 1);
      assert.equal(env.requests.filter((request) => request.method === 'tools/call').length, 1);
    } finally {
      await tools.close();
    }
  } finally {
    await env.close();
  }
});

test('disallowed raw tool names cannot be selected or invoked by guessing a model name', async () => {
  const env = await mcpFixture();
  try {
    await env.enable();
    env.requests.length = 0;
    const signal = new AbortController().signal;
    const tools = await env.mcp.create(
      env.session,
      32000,
      async () => {
        throw new Error('no approval');
      },
      signal,
      [],
      undefined,
      { servers: [{ serverId: env.config.id, tools: ['another-tool'] }] },
    );
    try {
      await tools.execute(
        'mcp_discover_tools',
        { serverId: env.config.id },
        signal,
        result('discover'),
      );
      const name = modelToolName(env.config.id, 'echo', 'echo');
      assert.ok(!tools.boundary().some((tool) => tool.modelName === name));
      await assert.rejects(tools.execute(name, { text: 'forbidden' }, signal, result(name)));
      assert.equal(env.requests.filter((request) => request.method === 'tools/call').length, 0);
    } finally {
      await tools.close();
    }
  } finally {
    await env.close();
  }
});
