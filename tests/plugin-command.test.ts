import { AgentRuntime } from '@praxis/agent-runtime';
import { PluginHost, type InstalledPlugin } from '@praxis/plugin-host';
import { SessionStore, uuid } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ToolExecutor } from '@praxis/tools';
import { WorkspaceFiles } from '@praxis/tools/files';

const record: InstalledPlugin = {
  manifest: {
    id: 'fixture.commands',
    version: '1.0.0',
    sdkVersion: '^1.0.0',
    entry: 'index.mjs',
    runtimes: ['local-host'],
    modes: ['agent', 'chat'],
    capabilities: ['user-command'],
    platforms: ['darwin', 'linux', 'win32'],
  },
  digest: 'a'.repeat(64),
  enabled: true,
};

test('a user command writes through core tools once, without a model, and retains its receipt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'praxis-command-'));
  const store = new SessionStore(':memory:');
  const host = new PluginHost(new Set(), 'agent');
  let calls = 0;
  await host.activate(record, {
    activate(ctx) {
      ctx.registerCommand(
        'hello',
        async (_input, services) => {
          calls++;
          return services.invokeCore('fs_write', {
            path: 'index.html',
            mode: 'create',
            content: '<h1>Hello World！！！</h1>',
          });
        },
        { type: 'object', properties: {}, additionalProperties: false },
      );
    },
  });
  const runtime = new AgentRuntime(store, {
    plugins: () => host.snapshot(),
    model: {
      async complete() {
        throw new Error('a command must not call the model');
      },
    },
    beginUse: async () => {
      throw new Error('a command does not need model credentials');
    },
  });
  const session = store.create('u', 'agent', root);
  const input = {
    sessionId: session.id,
    requestId: uuid(),
    pluginId: record.manifest.id,
    name: 'hello',
    arguments: {},
  };
  try {
    const accepted = runtime.command('u', input);
    assert.deepEqual(runtime.command('u', input), accepted);
    await runtime.wait(session.id);
    assert.equal(
      await readFile(path.join(root, 'index.html'), 'utf8'),
      '<h1>Hello World！！！</h1>',
    );
    assert.equal(calls, 1);
    assert.equal(store.get(session.id).status, 'completed');
    const result = store.events(session.id).find((e) => e.type === 'plugin/command-result');
    assert.equal(result?.payload.pluginId, record.manifest.id);
    assert.ok(result?.payload.artifactId);
    assert.deepEqual(runtime.command('u', input), accepted);
    await runtime.wait(session.id);
    assert.equal(calls, 1);
  } finally {
    await runtime.close();
    await host.dispose();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Chat user commands cannot acquire Agent tools, and invalid command parameters never execute', async () => {
  const store = new SessionStore(':memory:');
  const host = new PluginHost(new Set(), 'chat');
  let calls = 0;
  await host.activate(record, {
    activate(ctx) {
      ctx.registerCommand(
        'attempt',
        async (_input, services) => {
          calls++;
          return services.invokeCore('fs_write', { path: 'bad', mode: 'create', content: 'bad' });
        },
        { type: 'object', properties: {}, additionalProperties: false },
      );
    },
  });
  const runtime = new AgentRuntime(store, {
    plugins: () => host.snapshot(),
    beginUse: async () => {
      throw new Error('no provider');
    },
    model: {
      async complete() {
        throw new Error('no model');
      },
    },
  });
  const session = store.create('u', 'chat');
  try {
    assert.throws(() =>
      runtime.command('u', {
        sessionId: session.id,
        requestId: uuid(),
        pluginId: record.manifest.id,
        name: 'attempt',
        arguments: { unapproved: true },
      }),
    );
    assert.equal(calls, 0);
    runtime.command('u', {
      sessionId: session.id,
      requestId: uuid(),
      pluginId: record.manifest.id,
      name: 'attempt',
      arguments: {},
    });
    await runtime.wait(session.id);
    assert.equal(store.get(session.id).status, 'failed');
    assert.equal(calls, 1);
    assert.ok(store.events(session.id).some((e) => e.payload.code === 'PLUGIN_COMMAND_FAILED'));
  } finally {
    await runtime.close();
    await host.dispose();
    store.close();
  }
});

test('a closed turn executor cannot accept a late delegated file write', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'praxis-late-command-'));
  const store = new SessionStore(':memory:');
  const session = store.create('u', 'agent', root);
  const files = await WorkspaceFiles.open(root, (kind, text) =>
    store.artifact(session.id, kind, text),
  );
  const executor = new ToolExecutor(session.id, store, files, async () => ({}));
  try {
    await executor.close();
    const result = await executor.execute(
      {
        id: 'late',
        name: 'fs_write',
        arguments: JSON.stringify({ path: 'late.txt', mode: 'create', content: 'must not write' }),
      },
      'late',
      new AbortController().signal,
    );
    assert.equal(result.status, 'cancelled');
    await assert.rejects(readFile(path.join(root, 'late.txt')), { code: 'ENOENT' });
  } finally {
    await executor.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('cancelling a command revokes retained services and preserves a cancelled checkpoint', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'praxis-command-cancel-'));
  const store = new SessionStore(':memory:');
  const host = new PluginHost(new Set(), 'agent');
  let arrived!: () => void;
  const ready = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  let retained: import('@praxis/plugin-sdk').PluginServices | undefined;
  await host.activate(record, {
    activate(ctx) {
      ctx.registerCommand('wait', async (_args, services) => {
        retained = services;
        arrived();
        return new Promise(() => {});
      });
    },
  });
  const runtime = new AgentRuntime(store, {
    plugins: () => host.snapshot(),
    beginUse: async () => {
      throw new Error('no model credentials');
    },
    model: {
      complete: async () => {
        throw new Error('no model');
      },
    },
  });
  const session = store.create('u', 'agent', root);
  try {
    runtime.command('u', {
      sessionId: session.id,
      requestId: uuid(),
      pluginId: record.manifest.id,
      name: 'wait',
      arguments: {},
    });
    await ready;
    runtime.cancel('u', session.id);
    await runtime.wait(session.id);
    assert.equal(store.get(session.id).status, 'cancelled');
    assert.ok(retained?.signal.aborted);
    await assert.rejects(
      retained!.invokeCore('fs_write', { path: 'late.txt', mode: 'create', content: 'bad' }),
    );
    await assert.rejects(readFile(path.join(root, 'late.txt')), { code: 'ENOENT' });
    assert.equal(
      store.events(session.id).filter((e) => e.type === 'plugin/command-result').length,
      0,
    );
  } finally {
    await runtime.close();
    await host.dispose();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('delegated commands retain the session read-only policy', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'praxis-command-readonly-'));
  const store = new SessionStore(':memory:');
  const session = store.create('u', 'agent', root);
  store.update(session.id, { permission: { ...session.permission, mode: 'read-only' } });
  const files = await WorkspaceFiles.open(root, (kind, text) =>
    store.artifact(session.id, kind, text),
  );
  const executor = new ToolExecutor(session.id, store, files, async () => ({}));
  try {
    const result = await executor
      .delegate('fixture.commands', 'command', new AbortController().signal)
      .invokeCore('fs_write', { path: 'blocked.txt', mode: 'create', content: 'bad' });
    assert.equal(result.status, 'denied');
    await assert.rejects(readFile(path.join(root, 'blocked.txt')), { code: 'ENOENT' });
    assert.ok(
      store.timeline(session.id).some((message) => message.content.includes('ACCESS_DENIED')),
    );
  } finally {
    await executor.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
