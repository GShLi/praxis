import { protocolGroups } from '@praxis/context';
import assert from 'node:assert/strict';
import test from 'node:test';
import { projectionFixture as fixture } from './fixtures/context-projection.ts';

test('large older tool bodies become versioned artifact references without changing messages or MCP effects', async () => {
  const f = fixture();
  try {
    const original = f.store.messages(f.session.id);
    const messages = await f.build();
    protocolGroups(messages);
    assert.deepEqual(
      messages.find((m) => m.id === f.user.id),
      f.user,
    );
    assert.deepEqual(f.store.messages(f.session.id), original);
    const view = f.store.context(f.session.id);
    assert.equal(view.version, 1);
    assert.equal(view.summary, null);
    assert.equal(view.toolOutputs!.length, 5);
    const source = original.find((m) => m.toolCallId === 'call-0')!;
    const projected = JSON.parse(messages.find((m) => m.id === source.id)!.content);
    assert.equal(projected.effectState, 'unknown');
    assert.equal(projected.data.serverId, 'remote-server');
    assert.equal(projected.data.catalogGeneration, 'catalog-1');
    assert.equal(projected.data.content, undefined);
    assert.equal(
      f.store.readArtifact(f.session.id, projected.contextProjection.artifactId).content,
      source.content,
    );
    assert.deepEqual(messages.slice(-4), original.slice(-4));
    assert.deepEqual(await f.build(), messages);
    assert.equal(f.store.context(f.session.id).version, 1);
  } finally {
    f.store.close();
  }
});

test('cancelled projection rolls back its artifacts and publishes no context version', async () => {
  const f = fixture();
  const controller = new AbortController();
  const artifact = f.store.artifact.bind(f.store);
  f.store.artifact = (...args) => {
    const id = artifact(...args);
    controller.abort();
    return id;
  };
  try {
    await assert.rejects(f.build(controller.signal), { name: 'AbortError' });
    assert.equal(f.store.context(f.session.id).version, 0);
    assert.equal(f.store.db.prepare('SELECT count(*) AS count FROM artifacts').get()!.count, 0);
    assert.equal(
      f.store.events(f.session.id).filter((e) => e.type === 'context/compaction_committed').length,
      0,
    );
  } finally {
    f.store.close();
  }
});

test('a new view refuses foreign artifacts and invalid preserved user references', async () => {
  const f = fixture();
  try {
    await f.build();
    const view = f.store.context(f.session.id);
    const output = view.toolOutputs![0]!;
    const other = f.store.create('owner', 'chat');
    const artifactId = f.store.artifact(other.id, 'context-tool-output', 'unrelated');
    assert.throws(
      () =>
        f.store.publishContext(
          f.session.id,
          view.version,
          { ...view, toolOutputs: [{ ...output, artifactId }] },
          'tool-output',
        ),
      { code: 'INVALID_CONTEXT' },
    );
    assert.throws(
      () =>
        f.store.publishContext(
          f.session.id,
          view.version,
          { ...view, preservedMessageIds: [f.user.id] },
          'summary',
        ),
      { code: 'INVALID_CONTEXT' },
    );
    assert.equal(f.store.context(f.session.id).version, view.version);
  } finally {
    f.store.close();
  }
});
