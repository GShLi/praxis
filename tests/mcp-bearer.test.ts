import { McpCredentials, SecretStore } from '@praxis/mcp-client/credentials';
import { McpPrompts } from '@praxis/mcp-client/prompts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mcpFixture } from './fixtures/mcp-server.ts';

test('Bearer authentication reaches only its endpoint, rejects reflected secrets and invalidates active operations on rotation', async () => {
  let credentials: McpCredentials | undefined;
  const f = await mcpFixture(false, false, true, undefined, (config, signal) => {
    assert(credentials);
    return credentials.resolve(config, signal);
  });
  const values = new Map<string, string>();
  credentials = new McpCredentials(
    f.configs,
    new SecretStore({
      set: async (key, value) => {
        values.set(key, value);
      },
      get: async (key) => values.get(key),
      delete: async (key) => {
        values.delete(key);
      },
    }),
    'alice',
    'cli',
  );
  const prompts = new McpPrompts(f.mcp, f.configs, f.store, 'alice', (input, validate) =>
    f.store.accept(input, undefined, validate),
  );
  let release = () => {};
  try {
    await credentials.setBearer(f.config.id, 1, 1, 'fake-bearer-one');
    await f.enable();
    const catalog = await prompts.list(f.session.id, f.config.id);
    const input = {
      sessionId: f.session.id,
      serverId: f.config.id,
      generation: catalog.generation,
      name: 'page',
      arguments: { topic: 'test' },
    };
    assert.ok(f.requests.length > 0);
    assert.ok(f.requests.every((r) => r.headers.authorization === 'Bearer fake-bearer-one'));
    f.remote.prompts!.text = 'fake-bearer-one';
    await assert.rejects(prompts.preview(input), { code: 'MCP_SECRET_EXPOSURE' });
    assert.ok(!JSON.stringify(f.store.events(f.session.id)).includes('fake-bearer-one'));
    assert.equal(f.store.latestEvent(f.session.id, 'mcp/prompt-preview'), undefined);
    f.remote.unauthorizedBusiness = true;
    const beforeUnauthorized = f.requests.filter((r) => r.method === 'prompts/get').length;
    await assert.rejects(prompts.preview(input), { code: 'MCP_AUTH_REQUIRED' });
    assert.equal(
      f.requests.filter((r) => r.method === 'prompts/get').length,
      beforeUnauthorized + 1,
    );
    f.remote.unauthorizedBusiness = false;
    let arrived!: () => void;
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
    const stopped = assert.rejects(prompts.preview(input), { code: 'MCP_CANCELLED' });
    await ready;
    const state = await f.configs.file.read();
    await credentials.setBearer(
      f.config.id,
      state.revision,
      state.value[0]!.revision,
      'fake-bearer-two',
    );
    await stopped;
    release();
    await f.enable();
    const current = await prompts.list(f.session.id, f.config.id);
    assert.notEqual(current.generation, catalog.generation);
    assert.ok(current.binding.authEpoch > catalog.binding.authEpoch);
    assert.equal(f.requests.at(-1)?.headers.authorization, 'Bearer fake-bearer-two');
  } finally {
    release();
    await f.mcp.close();
    await credentials.close();
    await f.close();
  }
});
