import { AgentRuntime } from '@praxis/agent-runtime';
import type { ModelConfig } from '@praxis/contracts';
import { PluginHost, type InstalledPlugin } from '@praxis/plugin-host';
import { SessionStore, uuid } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePluginModel } from '@praxis/plugin-host';
import { DeepSeekClient, type ModelClient } from '@praxis/model-core';

const record: InstalledPlugin = {
  manifest: {
    id: 'fixture.provider',
    version: '1.0.0',
    sdkVersion: '^1.0.0',
    entry: 'index.mjs',
    runtimes: ['local-host'],
    modes: ['chat'],
    capabilities: ['model-provider'],
    platforms: ['darwin', 'linux', 'win32'],
  },
  digest: 'a'.repeat(64),
  enabled: true,
};
const config = {
  id: 'fixture',
  revision: 1,
  baseUrl: 'https://provider.invalid',
  model: 'test',
  apiKey: 'private-provider-fixture',
  contextWindow: 16000,
  maxOutputTokens: 1000,
  adapter: 'fixture.provider/custom',
};

test('an explicitly selected plugin provider handles the turn without calling the default adapter', async () => {
  const store = new SessionStore(':memory:');
  const host = new PluginHost(new Set(), 'chat');
  let pluginCalls = 0,
    defaultCalls = 0;
  await host.activate(record, {
    activate(ctx) {
      ctx.registerProvider('custom', {
        async complete(request) {
          pluginCalls++;
          assert.equal(request.config.apiKey, config.apiKey);
          assert.equal(request.tools.length, 0);
          request.onDelta('plugin answer');
          return {
            message: { id: uuid(), role: 'assistant', content: 'plugin answer' },
            usage: { input: 1, output: 1 },
            finishReason: 'stop',
          };
        },
      });
    },
  });
  const runtime = new AgentRuntime(store, {
    beginUse: async (): Promise<ModelConfig> => config,
    plugins: () => host.snapshot(),
    model: {
      async complete() {
        defaultCalls++;
        return {
          message: { id: uuid(), role: 'assistant', content: 'wrong adapter' },
          usage: { input: 1, output: 1 },
          finishReason: 'stop',
        };
      },
    },
  });
  const session = store.create('u', 'chat');
  try {
    runtime.prompt('u', { sessionId: session.id, requestId: uuid(), text: 'hello' });
    await runtime.wait(session.id);
    assert.equal(defaultCalls, 0);
    assert.equal(pluginCalls, 1);
    assert.equal(store.messages(session.id).at(-1)?.content, 'plugin answer');
    const request = store.events(session.id).find((e) => e.type === 'request/snapshot');
    assert.equal(request?.payload.adapter, 'fixture.provider/custom');
    assert.ok(!JSON.stringify(store.events(session.id)).includes(config.apiKey));
  } finally {
    await runtime.close();
    await host.dispose();
    store.close();
  }
});

test('missing selected plugin fails before any fallback can receive its credentials', async () => {
  const store = new SessionStore(':memory:');
  let calls = 0;
  const runtime = new AgentRuntime(store, {
    beginUse: async () => config,
    model: {
      async complete() {
        calls++;
        throw new Error('must not run');
      },
    },
  });
  const session = store.create('u', 'chat');
  try {
    runtime.prompt('u', { sessionId: session.id, requestId: uuid(), text: 'hello' });
    await runtime.wait(session.id);
    assert.equal(calls, 0);
    assert.equal(store.get(session.id).status, 'failed');
    assert.ok(
      store.events(session.id).some((e) => e.payload.code === 'PROVIDER_ADAPTER_UNAVAILABLE'),
    );
  } finally {
    await runtime.close();
    store.close();
  }
});

test('server plugin scope rejects local-only code before activation', async () => {
  const host = new PluginHost(new Set(), 'chat', 10000, 'server');
  let activated = false;
  try {
    await assert.rejects(
      host.activate(record, {
        activate() {
          activated = true;
        },
      }),
      { code: 'PLUGIN_INCOMPATIBLE' },
    );
    assert.equal(activated, false);
    const serverRecord = {
      ...record,
      manifest: { ...record.manifest, runtimes: ['server'] as const },
    };
    await host.activate(
      { ...serverRecord, manifest: { ...serverRecord.manifest, runtimes: ['server'] } },
      {
        activate(ctx) {
          ctx.registerProvider('custom', {
            async complete() {
              return {
                message: { id: 'answer', role: 'assistant', content: 'server plugin' },
                usage: { input: 1, output: 1 },
                finishReason: 'stop',
              };
            },
          });
        },
      },
    );
    const selected = resolvePluginModel(host.snapshot(), config, {
      async complete() {
        throw new Error('fallback');
      },
    });
    const response = await selected.model.complete({
      messages: [],
      tools: [],
      config,
      purpose: 'chat_generation',
      signal: AbortSignal.timeout(1000),
      onDelta: () => {},
    });
    assert.equal(response.message.content, 'server plugin');
  } finally {
    await host.dispose();
  }
});

async function pluginClient(client: ModelClient) {
  const host = new PluginHost(new Set(), 'chat');
  await host.activate(record, {
    activate(ctx) {
      ctx.registerProvider('custom', client);
    },
  });
  return { host, model: resolvePluginModel(host.snapshot(), config, new DeepSeekClient()).model };
}
const request = (signal = AbortSignal.timeout(1000)) => ({
  messages: [],
  tools: [],
  config,
  purpose: 'chat_generation' as const,
  signal,
  onDelta: (_text: string) => {},
});

test('plugin final response rejects credentials containing JSON escape characters', async () => {
  const secret = 'fixture-"quoted"-key\\suffix';
  const f = await pluginClient({
    async complete(input) {
      return {
        message: { id: uuid(), role: 'assistant', content: input.config.apiKey },
        usage: { input: 1, output: 1 },
        finishReason: 'stop',
      };
    },
  });
  try {
    await assert.rejects(
      f.model.complete({ ...request(), config: { ...config, apiKey: secret } }),
      { code: 'MODEL_SECRET_EXPOSURE' },
    );
  } finally {
    await f.host.dispose();
  }
});

test('plugin provider streams never publish a configured key split across deltas', async () => {
  const f = await pluginClient({
    async complete(input) {
      input.onDelta('before ' + config.apiKey.slice(0, 8));
      input.onDelta(config.apiKey.slice(8) + ' after');
      throw new Error('unreachable');
    },
  });
  let text = '';
  try {
    await assert.rejects(
      f.model.complete({
        ...request(),
        onDelta: (delta) => {
          text += delta;
        },
      }),
      { code: 'MODEL_SECRET_EXPOSURE' },
    );
    assert.ok(!text.includes(config.apiKey));
    assert.ok(!text.includes(config.apiKey.slice(0, 8)));
  } finally {
    await f.host.dispose();
  }
});

test('cancelling an uncooperative provider rejects promptly and discards late deltas', async () => {
  let late: ((value: string) => void) | undefined, started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const f = await pluginClient({
    async complete(input) {
      late = input.onDelta;
      started();
      return new Promise(() => {});
    },
  });
  const controller = new AbortController();
  let output = '';
  try {
    const operation = f.model.complete({
      ...request(controller.signal),
      onDelta: (text) => {
        output += text;
      },
    });
    await ready;
    controller.abort();
    await assert.rejects(operation, { name: 'AbortError' });
    late?.('late reply must not appear');
    assert.equal(output, '');
  } finally {
    await f.host.dispose();
  }
});

test('default HTTP adapter refuses an explicit plugin configuration before networking', async () => {
  let calls = 0;
  const fallback = new DeepSeekClient(async () => {
    calls++;
    throw new Error('must not fetch');
  });
  await assert.rejects(fallback.complete(request()), { code: 'PROVIDER_ADAPTER_UNAVAILABLE' });
  assert.equal(calls, 0);
});
