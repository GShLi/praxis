import { AgentRuntime, readEffectiveConfig } from '@praxis/agent-runtime';
import type { ModelClient, ModelRequest } from '@praxis/model-core';
import { SessionStore, uuid } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function fixture(model: ModelClient) {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-workspace-config-'));
  const store = new SessionStore(':memory:');
  await mkdir(path.join(root, '.praxis'));
  await writeFile(path.join(root, 'hidden.txt'), 'hidden from search');
  await writeFile(path.join(root, 'visible.txt'), 'visible in search');
  const runtime = new AgentRuntime(store, {
    model,
    beginUse: async () => ({
      id: 'fixture',
      revision: 1,
      model: 'fixture',
      apiKey: 'fixture-key',
      baseUrl: 'https://provider.invalid',
      contextWindow: 32000,
      maxOutputTokens: 1000,
    }),
  });
  const session = store.create('owner', 'agent', root);
  return {
    root,
    store,
    runtime,
    session,
    async configure(value: unknown) {
      await writeFile(path.join(root, '.praxis/config.json'), JSON.stringify(value));
    },
    async run() {
      runtime.prompt('owner', {
        sessionId: session.id,
        requestId: uuid(),
        text: '继续',
        mode: 'queue',
      });
      await runtime.wait(session.id);
    },
    async close() {
      await runtime.close();
      store.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
function answer(call?: { name: string; arguments: string }) {
  return {
    message: {
      id: uuid(),
      role: 'assistant' as const,
      content: call ? '' : 'done',
      ...(call ? { toolCalls: [{ ...call, id: uuid() }] } : {}),
    },
    usage: { input: 100, output: 100 },
    finishReason: call ? 'tool_calls' : 'stop',
  };
}

test('workspace configuration is pinned per turn, filters search, and retains versioned facts', async () => {
  const requests: ModelRequest[] = [];
  const f = await fixture({
    async complete(request) {
      requests.push(request);
      if (requests.length === 1) {
        await f.configure({
          schemaVersion: 1,
          ignore: [],
          context: { language: 'en', responseStyle: 'detailed' },
        });
        return answer({
          name: 'fs_find',
          arguments: JSON.stringify({ path: '.', pattern: '*.txt' }),
        });
      }
      return answer();
    },
  });
  try {
    await f.configure({
      schemaVersion: 1,
      ignore: ['hidden.txt'],
      context: { language: 'zh-CN', responseStyle: 'concise' },
      validationCommands: ['npm test'],
    });
    await f.run();
    assert.equal(f.store.get(f.session.id).status, 'completed');
    const tool = requests[1]?.messages.find((m) => m.role === 'tool');
    assert.ok(tool);
    assert.deepEqual(JSON.parse(tool.content).data.paths, ['visible.txt']);
    assert.match(
      requests[1]?.messages.find((m) => m.id.startsWith('workspace-config:'))?.content ?? '',
      /zh-CN/,
    );
    await f.run();
    assert.match(
      requests[2]?.messages.find((m) => m.id.startsWith('workspace-config:'))?.content ?? '',
      /detailed/,
    );
    const snapshots = f.store.events(f.session.id).filter((e) => e.type === 'config/effective');
    assert.deepEqual(
      snapshots.map((event) => event.payload.revision),
      [1, 2],
    );
    assert.ok(!JSON.stringify(snapshots).includes('fixture-key'));
    assert.equal(requests.length, 3);
    const latest = readEffectiveConfig(f.store, f.session.id);
    assert.equal(latest?.revision, 2);
    await f.run();
    assert.equal(readEffectiveConfig(f.store, f.session.id)?.revision, 2);
  } finally {
    await f.close();
  }
});

test('invalid workspace config prevents publishing Agent sessions while Chat never reads it', async () => {
  const f = await fixture({
    async complete() {
      return answer();
    },
  });
  try {
    await f.configure({ schemaVersion: 1, permission: 'full' });
    const before = f.store.list('owner').length;
    await assert.rejects(f.runtime.create('owner', 'agent', f.root), {
      code: 'WORKSPACE_CONFIG_INVALID',
    });
    assert.equal(f.store.list('owner').length, before);
    const chat = await f.runtime.create('owner', 'chat', f.root);
    f.runtime.prompt('owner', {
      sessionId: chat.id,
      requestId: uuid(),
      text: 'hello',
      mode: 'queue',
    });
    await f.runtime.wait(chat.id);
    assert.equal(f.store.get(chat.id).status, 'completed');
    assert.equal(readEffectiveConfig(f.store, chat.id)?.values.workspace, null);
  } finally {
    await f.close();
  }
});

test('workspace JSON cannot add keys, providers, plugins, or execution permissions', async () => {
  let calls = 0;
  const f = await fixture({
    async complete() {
      calls++;
      return answer();
    },
  });
  try {
    for (const forbidden of ['apiKey', 'provider', 'plugins', 'permission', 'serverUrl']) {
      await f.configure({ schemaVersion: 1, [forbidden]: 'must-not-persist' });
      await f.run();
      assert.equal(f.store.get(f.session.id).status, 'failed');
      assert.ok(!JSON.stringify(f.store.events(f.session.id)).includes('must-not-persist'));
    }
    assert.equal(calls, 0);
  } finally {
    await f.close();
  }
});

test('effective config read detects altered persisted facts instead of trusting a stale hash', async () => {
  const f = await fixture({
    async complete() {
      return answer();
    },
  });
  try {
    await f.run();
    const snapshot = readEffectiveConfig(f.store, f.session.id);
    assert.ok(snapshot);
    f.store.append(f.session.id, 'config/effective', {
      ...snapshot,
      turnId: uuid(),
      values: { ...snapshot.values, budgets: { ...snapshot.values.budgets, steps: 999 } },
    });
    assert.throws(() => readEffectiveConfig(f.store, f.session.id), {
      code: 'CONFIG_SNAPSHOT_CORRUPT',
    });
  } finally {
    await f.close();
  }
});
