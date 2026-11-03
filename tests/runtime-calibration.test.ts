import { AgentRuntime } from '@praxis/agent-runtime';
import type { ModelConfig } from '@praxis/contracts';
import { SessionStore } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { calibrationModel, snapshotFactor } from './fixtures/calibration.ts';

const config: ModelConfig = {
  id: 'fixture',
  revision: 1,
  model: 'fixture',
  baseUrl: 'https://provider.invalid',
  apiKey: 'calibration-secret',
  contextWindow: 12000,
  maxOutputTokens: 1000,
};
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-calibration-'));
  const database = path.join(root, 'sessions.sqlite');
  let store = new SessionStore(database);
  const { model, calls } = calibrationModel(2);
  let revision = 1;
  const options = { model, beginUse: async () => ({ ...config, revision }) };
  let runtime = new AgentRuntime(store, options);
  const session = store.create('owner', 'chat');
  for (let i = 0; i < 12; i++)
    store.message(session.id, {
      id: crypto.randomUUID(),
      role: i % 2 ? 'assistant' : 'user',
      content: 'old detail '.repeat(60),
    });
  const send = async (nextRevision = 1) => {
    revision = nextRevision;
    runtime.prompt('owner', {
      sessionId: session.id,
      requestId: crypto.randomUUID(),
      text: '继续',
    });
    await runtime.wait(session.id);
    assert.equal(
      store.get(session.id).status,
      'completed',
      JSON.stringify(store.events(session.id).filter((e) => e.type === 'turn/error')),
    );
  };
  return {
    get store() {
      return store;
    },
    session,
    send,
    calls,
    factor: () => snapshotFactor(store.latestEvent(session.id, 'request/snapshot')),
    async reopen() {
      await runtime.close();
      store.close();
      store = new SessionStore(database);
      runtime = new AgentRuntime(store, options);
    },
    async close() {
      await runtime.close();
      store.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
test('local runtime restores scoped calibration after reopening and compacts without losing raw history', async () => {
  const f = await fixture();
  try {
    await f.send();
    assert.equal(f.calls.summaries, 0);
    assert.equal(f.factor(), 1);
    await f.reopen();
    await f.send();
    assert.ok(f.calls.summaries > 0);
    assert.ok(f.store.context(f.session.id).version > 0);
    assert.equal(f.store.messages(f.session.id).length, 16);
    assert.equal(f.factor(), 2.2);
    await f.send(2);
    assert.equal(f.factor(), 1);
    const snapshots = f.store.events(f.session.id).filter((e) => e.type === 'request/snapshot');
    for (const event of f.store.events(f.session.id).filter((e) => e.type === 'model/usage'))
      assert.ok(snapshots.some((s) => s.payload.requestId === event.payload.requestId));
  } finally {
    await f.close();
  }
});
