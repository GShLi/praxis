import { McpPrompts } from '@praxis/mcp-client/prompts';
import { uuid } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mcpFixture } from './fixtures/mcp-server.ts';

async function fixture(legacy = false) {
  const env = await mcpFixture(legacy, false, true);
  await env.enable();
  const prompts = new McpPrompts(env.mcp, env.configs, env.store, 'alice', (input, validate) =>
    env.store.accept(input, undefined, validate),
  );
  return { ...env, prompts };
}
for (const legacy of [false, true])
  test(`MCP prompt preview/apply is explicit, immutable and idempotent (${legacy ? 'legacy' : 'modern'})`, async () => {
    const f = await fixture(legacy);
    try {
      const list = await f.prompts.list(f.session.id, f.config.id);
      assert.equal(list.entries[0]?.name, 'page');
      const preview = await f.prompts.preview({
        sessionId: f.session.id,
        serverId: f.config.id,
        generation: list.generation,
        name: 'page',
        arguments: { topic: 'hello' },
      });
      assert.equal(f.store.inputs(f.session.id, 'pending').length, 0);
      assert.match(preview.text, /外部模板/);
      const request = {
        sessionId: f.session.id,
        requestId: uuid(),
        previewId: preview.previewId,
        contentHash: preview.contentHash,
        mode: 'queue' as const,
      };
      const receipt = await f.prompts.apply(request);
      const state = await f.configs.file.read();
      await f.configs.disable(f.config.id, state.revision);
      assert.deepEqual(await f.prompts.apply(request), receipt);
      assert.equal(f.store.inputs(f.session.id, 'pending').length, 1);
      f.store.claim(f.session.id, 'turn', true);
      const messages = f.store.messages(f.session.id);
      assert.equal(messages.length, 1);
      assert.equal(messages[0]?.role, 'user');
      assert.match(messages[0]!.content, /I already executed/);
      assert.equal(f.requests.filter((r) => r.method === 'prompts/get').length, 1);
      assert.equal(
        f.store.events(f.session.id).filter((e) => e.type === 'mcp/prompt-applied').length,
        1,
      );
      await assert.rejects(f.prompts.apply({ ...request, requestId: uuid() }), {
        code: 'MCP_CONFIG_CHANGED',
      });
    } finally {
      await f.close();
    }
  });

test('MCP prompt catalog changes, cross-session references, bad args and binary content fail explicitly', async () => {
  const f = await fixture();
  try {
    const list = await f.prompts.list(f.session.id, f.config.id);
    const input = {
      sessionId: f.session.id,
      serverId: f.config.id,
      generation: list.generation,
      name: 'page',
      arguments: { topic: 'hello' },
    };
    await assert.rejects(f.prompts.preview({ ...input, arguments: {} }), {
      code: 'MCP_PROMPT_ARGUMENTS',
    });
    f.remote.prompts!.description = 'new definition';
    await assert.rejects(f.prompts.preview(input), { code: 'MCP_CATALOG_CHANGED' });
    const current = await f.prompts.list(f.session.id, f.config.id);
    const preview = await f.prompts.preview({ ...input, generation: current.generation });
    const another = f.store.create('alice', 'agent', f.root);
    await assert.rejects(
      f.prompts.apply({
        sessionId: another.id,
        previewId: preview.previewId,
        requestId: uuid(),
        contentHash: preview.contentHash,
        mode: 'queue',
      }),
      { code: 'ARTIFACT_UNAVAILABLE' },
    );
    f.remote.prompts!.binary = true;
    await assert.rejects(f.prompts.preview({ ...input, generation: current.generation }), {
      code: 'MCP_CONTENT_UNSUPPORTED',
    });
    assert.equal(f.store.inputs(f.session.id, 'pending').length, 0);
  } finally {
    await f.close();
  }
});

test('user cancellation closes a prompt fetch without applying or replaying it', async () => {
  const f = await fixture();
  let arrived!: () => void, release!: () => void;
  const ready = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.remote.prompts!.beforeGet = async () => {
    arrived();
    await hold;
  };
  try {
    const list = await f.prompts.list(f.session.id, f.config.id);
    const pending = f.prompts.preview({
      sessionId: f.session.id,
      serverId: f.config.id,
      generation: list.generation,
      name: 'page',
      arguments: { topic: 'test' },
    });
    const stopped = assert.rejects(pending, { code: 'MCP_CANCELLED' });
    await ready;
    f.mcp.cancelUserOperations(f.session.id);
    await stopped;
    assert.equal(f.requests.filter((r) => r.method === 'prompts/get').length, 1);
    assert.equal(
      f.store.events(f.session.id).filter((e) => e.type === 'mcp/prompt-preview').length,
      0,
    );
  } finally {
    release();
    await f.close();
  }
});
