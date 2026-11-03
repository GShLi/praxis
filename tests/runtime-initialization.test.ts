import { AgentRuntime } from '@praxis/agent-runtime';
import { SessionStore, uuid } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

for (const failure of ['initialize', 'process-close', 'extension-close'])
  test(`tool-extension initialization failure releases owned resources (${failure})`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'praxis-init-'));
    const store = new SessionStore(':memory:');
    let closed = 0,
      created = 0,
      modelCalls = 0;
    const runtime = new AgentRuntime(store, {
      model: {
        complete: async () => {
          modelCalls++;
          throw new Error('unexpected model call');
        },
      },
      beginUse: async () => ({
        id: 'fixture',
        revision: 1,
        baseUrl: 'https://example.invalid',
        apiKey: 'fixture',
        model: 'fixture',
        contextWindow: 32000,
        maxOutputTokens: 1000,
      }),
      processes: () => {
        created++;
        const unused = () => {
          throw new Error('processes must not run');
        };
        return {
          active: false,
          execute: unused,
          read: unused,
          cancel: unused,
          list: unused,
          close: async () => {
            closed++;
            if (failure === 'process-close') throw new Error('cleanup failure');
          },
        };
      },
      toolExtension: async (session) => {
        if (failure !== 'extension-close') throw new Error('fixture initialization failure');
        runtime.cancel('alice', session.id);
        return {
          boundary: () => [],
          execute: async () => {},
          close() {
            throw new Error('synchronous cleanup failure');
          },
        };
      },
    });
    try {
      const session = await runtime.create('alice', 'agent', root);
      runtime.prompt('alice', {
        sessionId: session.id,
        requestId: uuid(),
        text: 'test',
        mode: 'queue',
      });
      await runtime.wait(session.id);
      assert.equal(
        store.get(session.id).status,
        failure === 'initialize' ? 'failed' : 'interrupted',
      );
      assert.equal(
        Boolean(store.latestEvent(session.id, 'execution/cleanup_unknown')),
        failure !== 'initialize',
      );
      assert.equal(created, 1);
      assert.equal(closed, 1);
      assert.equal(modelCalls, 0);
      await runtime.close();
      assert.equal(closed, 1);
    } finally {
      await runtime.close();
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
