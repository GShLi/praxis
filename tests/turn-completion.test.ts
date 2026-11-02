import { AgentRuntime } from '@praxis/agent-runtime';
import { SessionStore, uuid } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const config = {
  id: 'fixture',
  revision: 1,
  baseUrl: 'https://model.invalid',
  model: 'fixture',
  apiKey: 'fixture',
  contextWindow: 32000,
  maxOutputTokens: 1000,
};

test('final input claim closes steer acceptance before yielding to cleanup', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-final-steer-'));
  const store = new SessionStore(':memory:');
  const session = store.create('alice', 'agent', root);
  let complete = false,
    scheduled = false,
    rejected: unknown;
  const runtime = new AgentRuntime(store, {
    beginUse: async () => config,
    model: {
      async complete() {
        return {
          message: { id: uuid(), role: 'assistant', content: 'done' },
          usage: { input: 1, output: 1 },
          finishReason: 'stop',
        };
      },
    },
  });
  store.on('event', (e) => {
    if (e.type === 'step/finished') complete = true;
  });
  const original = store.claim.bind(store);
  store.claim = (...args) => {
    const result = original(...args);
    if (complete && !scheduled) {
      scheduled = true;
      const expectedTurnId = runtime.getTurn(session.id)!;
      queueMicrotask(() => {
        try {
          runtime.prompt('alice', {
            sessionId: session.id,
            requestId: uuid(),
            text: 'late steer',
            mode: 'steer',
            expectedTurnId,
          });
        } catch (error) {
          rejected = error;
        }
      });
    }
    return result;
  };
  try {
    runtime.prompt('alice', { sessionId: session.id, requestId: uuid(), text: 'finish' });
    await runtime.wait(session.id);
    assert.equal(scheduled, true);
    assert.equal((rejected as { code?: string } | undefined)?.code, 'TURN_CONFLICT');
    assert.equal(store.inputs(session.id, 'pending').length, 0);
    assert.equal(store.events(session.id).filter((e) => e.type === 'input/accepted').length, 1);
  } finally {
    await runtime.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
