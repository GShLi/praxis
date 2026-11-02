import assert from 'node:assert/strict';
import test from 'node:test';
import { mcpExecutor } from './fixtures/mcp-executor.ts';

test('legacy HTTP tools retain old initialization and produce one approved result', async () => {
  const env = await mcpExecutor(true);
  try {
    const name = await env.select();
    const result = await env.execute(name, { text: 'echo' });
    assert.equal(result.status, 'succeeded');
    const data = result.data as { protocolVersion: string; structuredContent: unknown };
    assert.equal(data.protocolVersion, '2025-11-25');
    assert.deepEqual(data.structuredContent, { value: false });
    const calls = env.requests.filter((r) => r.method === 'tools/call');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.headers['mcp-param-text'], undefined);
    assert.equal(env.requests.filter((r) => r.method === 'server/discover').length, 0);
  } finally {
    await env.close();
  }
});

test('changed catalog, declined approval and known credentials prevent MCP business dispatch', async () => {
  for (const scenario of ['catalog', 'deny', 'secret']) {
    const env = await mcpExecutor();
    try {
      const name = await env.select();
      if (scenario === 'catalog') env.remote.description = 'Changed implementation';
      if (scenario === 'deny') env.decisions.deny = true;
      const result = await env.execute(name, {
        text: scenario === 'secret' ? 'fixture-model-secret' : 'echo',
      });
      assert.equal(
        result.error?.code,
        scenario === 'catalog'
          ? 'MCP_CATALOG_CHANGED'
          : scenario === 'deny'
            ? 'APPROVAL_REJECTED'
            : 'MCP_SECRET_DENIED',
      );
      assert.equal(result.effectState, 'none');
      assert.equal(env.requests.filter((r) => r.method === 'tools/call').length, 0);
      if (scenario === 'secret')
        assert.equal(
          env.store.events(env.session.id).filter((e) => e.type === 'approval/requested').length,
          0,
        );
    } finally {
      await env.close();
    }
  }
});

test('permission changes during catalog verification invalidate approval before dispatch', async () => {
  const env = await mcpExecutor();
  try {
    const name = await env.select();
    env.remote.beforeList = async () => {
      env.store.update(env.session.id, {
        permission: { mode: 'read-only', approval: 'ask', revision: 1 },
      });
    };
    const result = await env.execute(name, { text: 'echo' });
    assert.equal(result.error?.code, 'APPROVAL_EXPIRED');
    assert.equal(result.effectState, 'none');
    assert.equal(env.requests.filter((r) => r.method === 'tools/call').length, 0);
  } finally {
    await env.close();
  }
});

test('disabling server cancels a pending approval and all later operations of the old turn', async () => {
  const env = await mcpExecutor();
  try {
    const name = await env.select();
    env.decisions.autoApprove = false;
    let asked!: () => void;
    const waiting = new Promise<void>((resolve) => {
      asked = resolve;
    });
    env.store.on('event', (e) => {
      if (e.type === 'approval/requested') asked();
    });
    const running = env.execute(name, { text: 'echo' });
    await waiting;
    const state = await env.configs.file.read();
    await env.configs.disable(env.config.id, state.revision);
    const result = await running;
    assert.equal(result.error?.code, 'CANCELLED');
    assert.equal(env.approval.snapshot(env.session.id), null);
    const later = await env.execute(name, { text: 'later' });
    assert.equal(later.error?.code, 'MCP_CONFIG_CHANGED');
    assert.equal(env.requests.filter((r) => r.method === 'tools/call').length, 0);
  } finally {
    await env.close();
  }
});

test('remote business errors, invalid output and disconnection preserve unknown effects without replay', async () => {
  for (const scenario of ['business', 'schema', 'disconnect']) {
    const env = await mcpExecutor();
    try {
      const name = await env.select();
      env.remote.isError = scenario === 'business';
      env.remote.invalidOutput = scenario === 'schema';
      env.remote.disconnect = scenario === 'disconnect';
      const result = await env.execute(name, { text: 'echo' });
      assert.equal(result.status, 'failed');
      assert.equal(result.effectState, 'unknown');
      assert.equal(
        result.error?.code,
        scenario === 'business'
          ? 'MCP_TOOL_FAILED'
          : scenario === 'disconnect'
            ? 'MCP_NETWORK_FAILED'
            : 'MCP_PROTOCOL_FAILED',
      );
      assert.equal(env.requests.filter((r) => r.method === 'tools/call').length, 1);
      assert.equal(
        env.store.events(env.session.id).filter((e) => e.type === 'mcp/dispatch').length,
        1,
      );
    } finally {
      await env.close();
    }
  }
});

test('turn cancellation after dispatch stops waiting and does not claim remote rollback', async () => {
  const env = await mcpExecutor();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const name = await env.select();
    env.remote.beforeCall = async () => {
      env.cancel.abort();
      await held;
    };
    const result = await env.execute(name, { text: 'echo' });
    assert.equal(result.status, 'cancelled');
    assert.equal(result.effectState, 'unknown');
    assert.equal(env.requests.filter((r) => r.method === 'tools/call').length, 1);
  } finally {
    release();
    await env.close();
  }
});

test('unsupported input-required result is never continued or persisted as reusable state', async () => {
  const env = await mcpExecutor();
  try {
    const name = await env.select();
    env.remote.inputRequired = true;
    const result = await env.execute(name, { text: 'echo' });
    assert.equal(result.error?.code, 'MCP_CAPABILITY_UNSUPPORTED');
    assert.equal(result.effectState, 'unknown');
    assert.equal(env.requests.filter((r) => r.method === 'tools/call').length, 1);
    assert.equal(
      JSON.stringify(env.store.events(env.session.id)).includes('private-resume-state'),
      false,
    );
  } finally {
    await env.close();
  }
});
