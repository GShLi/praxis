import { SessionStore, uuid } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('restart records interrupted MCP operations once without restoring network or authority', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-mcp-recovery-'));
  const file = path.join(root, 'sessions.sqlite');
  let store = new SessionStore(file);
  try {
    const session = store.create('alice', 'agent', root);
    store.update(session.id, { status: 'running' });
    for (const id of ['before-dispatch', 'after-dispatch', 'finished']) {
      store.append(session.id, 'mcp/operation-started', {
        operationId: id,
        callId: uuid(),
        toolId: 'echo',
        serverId: uuid(),
        configRevision: 1,
      });
      if (id !== 'before-dispatch') store.append(session.id, 'mcp/dispatch', { operationId: id });
      if (id === 'finished')
        store.append(session.id, 'mcp/operation-finished', {
          operationId: id,
          status: 'succeeded',
        });
    }
    store.close();
    store = new SessionStore(file);
    store.recover();
    store.recover();
    const recovered = store.events(session.id).filter((e) => e.type === 'mcp/operation-finished');
    assert.equal(recovered.length, 3);
    assert.equal(
      recovered.find((e) => e.payload.operationId === 'before-dispatch')?.payload.effectState,
      'none',
    );
    assert.equal(
      recovered.find((e) => e.payload.operationId === 'after-dispatch')?.payload.effectState,
      'unknown',
    );
    assert.equal(
      recovered.find((e) => e.payload.operationId === 'after-dispatch')?.payload.replayed,
      false,
    );
    assert.equal(store.get(session.id).status, 'interrupted');
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('recovery preserves operation state across multiple bounded event pages', () => {
  const store = new SessionStore(':memory:');
  try {
    const session = store.create('u', 'agent', '/fixture');
    store.update(session.id, { status: 'running' });
    const serverId = uuid();
    store.transaction(() => {
      for (let index = 0; index < 510; index++)
        store.append(session.id, 'mcp/operation-started', {
          operationId: `operation-${index}`,
          callId: uuid(),
          toolId: 'fixture',
          serverId,
          configRevision: 1,
        });
      for (let index = 0; index < 509; index++)
        store.append(session.id, 'mcp/operation-finished', {
          operationId: `operation-${index}`,
          status: 'succeeded',
        });
      store.append(session.id, 'mcp/dispatch', { operationId: 'operation-509' });
    });
    store.recover();
    const result = store.latestEvent(session.id, 'mcp/operation-finished');
    assert.equal(result?.payload.operationId, 'operation-509');
    assert.equal(result?.payload.effectState, 'unknown');
    assert.equal(result?.payload.status, 'interrupted');
    store.recover();
    assert.equal(store.latestEvent(session.id, 'mcp/operation-finished')?.eventId, result?.eventId);
  } finally {
    store.close();
  }
});
