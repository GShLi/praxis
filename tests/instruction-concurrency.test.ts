import { AgentRuntime } from '@praxis/agent-runtime';
import { PluginHost, type InstalledPlugin } from '@praxis/plugin-host';
import { SessionStore, uuid } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('concurrent plugin reads retain both directory instruction scopes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'praxis-instructions-parallel-'));
  for (const name of ['a', 'b']) {
    await mkdir(path.join(root, name));
    await writeFile(path.join(root, name, 'AGENTS.md'), `RULE-${name}`);
  }
  const plugin = new PluginHost(new Set(), 'agent');
  const record: InstalledPlugin = {
    manifest: {
      id: 'fixture.parallel',
      version: '1.0.0',
      entry: 'index.mjs',
      sdkVersion: '^1.0.0',
      runtimes: ['local-host'],
      modes: ['agent'],
      platforms: ['darwin', 'linux', 'win32'],
      capabilities: ['agent-tool'],
    },
    digest: 'a'.repeat(64),
    enabled: true,
  };
  let persistedScopes = 0;
  await plugin.activate(record, {
    activate(ctx) {
      ctx.registerTool({
        name: 'read_both',
        description: 'read both',
        parameters: { type: 'object', properties: {} },
        execute: async (_args, services) => {
          const result = await Promise.all(
            ['a', 'b'].map((name) => services.invokeCore('fs_read', { path: `${name}/AGENTS.md` })),
          );
          persistedScopes = (
            store.latestEvent(session.id, 'instructions/snapshot')?.payload.sources as unknown[]
          ).length;
          return result;
        },
      });
    },
  });
  const store = new SessionStore(':memory:');
  const session = store.create('u', 'agent', root);
  let calls = 0;
  const runtime = new AgentRuntime(store, {
    plugins: () => plugin.snapshot(),
    beginUse: async () => ({
      id: 'fixture',
      revision: 1,
      baseUrl: 'https://example.invalid',
      apiKey: 'fixture',
      model: 'fixture',
      contextWindow: 128000,
      maxOutputTokens: 1000,
    }),
    model: {
      async complete(request) {
        calls++;
        if (calls > 1) {
          const instructions = request.messages
            .filter((m) => m.id.startsWith('instructions:'))
            .map((m) => m.content)
            .join('\n');
          assert.match(instructions, /RULE-a/);
          assert.match(instructions, /RULE-b/);
        }
        return {
          message: {
            id: uuid(),
            role: 'assistant',
            content: '',
            ...(calls === 1
              ? { toolCalls: [{ id: uuid(), name: 'read_both', arguments: '{}' }] }
              : {}),
          },
          usage: { input: 0, output: 0 },
          finishReason: calls === 1 ? 'tool_calls' : 'stop',
        };
      },
    },
  });
  try {
    runtime.prompt('u', { sessionId: session.id, requestId: uuid(), text: 'read', mode: 'queue' });
    await runtime.wait(session.id);
    assert.equal(store.get(session.id).status, 'completed');
    assert.equal(calls, 2);
    assert.equal(persistedScopes, 2);
  } finally {
    await runtime.close();
    await plugin.dispose();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
