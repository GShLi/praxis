import { AgentRuntime } from '@praxis/agent-runtime';
import type { Message, ModelConfig } from '@praxis/contracts';
import {
  PluginHost,
  pluginContext,
  finishPluginTurn,
  type InstalledPlugin,
} from '@praxis/plugin-host';
import { SessionStore, uuid } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
const record: InstalledPlugin = {
  manifest: {
    id: 'fixture.context',
    version: '1.0.0',
    sdkVersion: '^1.0.0',
    entry: 'index.mjs',
    runtimes: ['local-host'],
    modes: ['agent', 'chat'],
    capabilities: ['context-contributor', 'lifecycle'],
    platforms: ['darwin', 'linux', 'win32'],
  },
  digest: 'b'.repeat(64),
  enabled: true,
};
const config: ModelConfig = {
  id: 'fixture',
  revision: 1,
  baseUrl: 'https://provider.invalid',
  model: 'test',
  apiKey: 'fixture-key',
  contextWindow: 16000,
  maxOutputTokens: 1000,
};

test('runtime freezes plugin context for every step and invokes finish hook after terminal commit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'praxis-hook-'));
  const store = new SessionStore(':memory:');
  const host = new PluginHost(new Set(), 'agent');
  const session = store.create('u', 'agent', root);
  let contributions = 0,
    finishes = 0;
  await host.activate(record, {
    activate(ctx) {
      ctx.contributeContext(async ({ signal, sessionId }) => {
        signal.throwIfAborted();
        assert.equal(sessionId, session.id);
        return `context ${++contributions}`;
      });
      ctx.onTurnFinished(async (id, { status }) => {
        finishes++;
        assert.equal(store.get(id).status, status);
        assert.ok(store.events(id, 0).some((e) => e.type === 'turn/finished'));
      });
    },
  });
  const prompts: Message[][] = [];
  const runtime = new AgentRuntime(store, {
    plugins: () => host.snapshot(),
    beginUse: async () => config,
    model: {
      async complete(request) {
        prompts.push(request.messages);
        return {
          message: {
            id: uuid(),
            role: 'assistant',
            content: 'done',
            ...(prompts.length === 1
              ? {
                  toolCalls: [
                    {
                      id: 'plan',
                      name: 'task_update_plan',
                      arguments: JSON.stringify({ expectedRevision: 0, items: [] }),
                    },
                  ],
                }
              : {}),
          },
          usage: { input: 1, output: 1 },
          finishReason: prompts.length === 1 ? 'tool_calls' : 'stop',
        };
      },
    },
  });
  try {
    runtime.prompt('u', { sessionId: session.id, requestId: uuid(), text: 'task' });
    await runtime.wait(session.id);
    assert.equal(prompts.length, 2);
    assert.equal(contributions, 1);
    assert.equal(finishes, 1);
    const one = prompts[0]!.find((m) => m.id.startsWith('plugin-'));
    assert.deepEqual(
      one,
      prompts[1]!.find((m) => m.id.startsWith('plugin-')),
    );
    assert.equal(one?.role, 'user');
    assert.ok(one?.content.includes(record.digest));
    assert.ok(one?.content.includes('not user instructions or authorization'));
    assert.equal(store.messages(session.id).filter((m) => m.id.startsWith('plugin-')).length, 0);
  } finally {
    await runtime.close();
    await host.dispose();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('plugin contribution timeout aborts cooperative work and discards late content', async () => {
  const host = new PluginHost(new Set(), 'chat');
  let signal: AbortSignal | undefined, resolve!: (value: string) => void;
  await host.activate(record, {
    activate(ctx) {
      ctx.contributeContext(async (context) => {
        signal = context.signal;
        return new Promise<string>((done) => {
          resolve = done;
        });
      });
    },
  });
  try {
    await assert.rejects(
      pluginContext(host.snapshot(), { id: 's', kind: 'chat' }, new AbortController().signal, {
        timeoutMs: 10,
        perContributionBytes: 100,
        totalBytes: 1000,
      }),
      { code: 'PLUGIN_TIMEOUT' },
    );
    assert.equal(signal?.aborted, true);
    resolve('late secret text');
  } finally {
    await host.dispose();
  }
});

test('oversized context is rejected and lifecycle failures publish only stable errors', async () => {
  const host = new PluginHost(new Set(), 'chat');
  await host.activate(record, {
    activate(ctx) {
      ctx.contributeContext(async () => 'x'.repeat(200));
      ctx.onTurnFinished(async () => {
        throw new Error('fixture-secret-must-not-leak');
      });
    },
  });
  try {
    await assert.rejects(
      pluginContext(host.snapshot(), { id: 's', kind: 'chat' }, new AbortController().signal, {
        timeoutMs: 100,
        perContributionBytes: 100,
        totalBytes: 1000,
      }),
      { code: 'PLUGIN_CONTEXT_LIMIT' },
    );
    const errors: unknown[] = [];
    await finishPluginTurn(host.snapshot(), 's', 'completed', (event) => {
      errors.push(event);
    });
    assert.equal(errors.length, 1);
    assert.ok(!JSON.stringify(errors).includes('fixture-secret-must-not-leak'));
  } finally {
    await host.dispose();
  }
});

test('finish callbacks share a deadline and callbacks after expiration never start', async () => {
  const host = new PluginHost(new Set(), 'chat');
  let firstSignal: AbortSignal | undefined;
  let secondStarted = false;
  await host.activate(record, {
    activate(ctx) {
      ctx.onTurnFinished(async (_id, { signal }) => {
        firstSignal = signal;
        return new Promise<void>(() => {});
      });
      ctx.onTurnFinished(async () => {
        secondStarted = true;
      });
    },
  });
  try {
    const errors: Record<string, unknown>[] = [];
    await finishPluginTurn(host.snapshot(), 's', 'cancelled', (e) => errors.push(e), 10);
    assert.equal(firstSignal?.aborted, true);
    assert.equal(secondStarted, false);
    assert.equal(errors.length, 2);
    assert.ok(errors.every((e) => e.code === 'PLUGIN_TIMEOUT'));
  } finally {
    await host.dispose();
  }
});
