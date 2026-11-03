import { ChatRuntime } from '@praxis/chat-runtime';
import assert from 'node:assert/strict';
import test from 'node:test';
import { chatFixture, finished } from './chat-fixture.ts';
import { provider } from './fixture.ts';
import { calibrationModel, snapshotFactor } from '../fixtures/calibration.ts';

async function send(
  runtime: ChatRuntime,
  f: Awaited<ReturnType<typeof chatFixture>>,
  text: string,
) {
  const done = finished(runtime, f.chat.id);
  await runtime.submit(f.identity.userId, f.chat.id, {
    requestId: crypto.randomUUID(),
    text,
    providerId: f.config.id,
    pageId: 'fixture',
  });
  const result = await done;
  assert.equal(
    result.payload.status,
    'completed',
    JSON.stringify(
      (await runtime.events(f.identity.userId, f.chat.id, 0)).filter(
        (e) => e.type === 'generation/error',
      ),
    ),
  );
}

test('Web reloads model-scoped usage from PostgreSQL and applies it to automatic compaction', async () => {
  const { model: client, calls } = calibrationModel(3);
  const f = await chatFixture(client);
  let runtime = f.runtime;
  try {
    await f.auth.saveProvider(
      f.identity,
      { ...provider, contextWindow: 12000, maxOutputTokens: 1000 },
      undefined,
      f.config.id,
      1,
    );
    await send(runtime, f, 'detail '.repeat(700));
    assert.equal(calls.summaries, 0);
    await runtime.close();
    runtime = new ChatRuntime(f.database, client, (_owner, id) =>
      f.auth.beginUse(f.identity, id, false),
    );
    await send(runtime, f, '继续');
    assert.ok(calls.summaries > 0);
    const contexts = await f.database.query('SELECT version FROM chat_contexts');
    assert.ok(contexts.rowCount! > 0);
    const events = await runtime.events(f.identity.userId, f.chat.id, 0);
    const snapshots = events.filter((e) => e.type === 'request/snapshot');
    assert.ok(Math.abs(snapshotFactor(snapshots.at(-1)) - 3.3) < 1e-12);
    for (const usage of events.filter((e) => e.type === 'model/usage'))
      assert.ok(snapshots.some((s) => s.payload.requestId === usage.payload.requestId));
    assert.equal((await runtime.history(f.identity.userId, f.chat.id)).inputs.length, 2);
    await f.auth.saveProvider(
      f.identity,
      { ...provider, contextWindow: 12000, maxOutputTokens: 1000 },
      undefined,
      f.config.id,
      2,
    );
    await send(runtime, f, '再继续');
    const latest = (await runtime.events(f.identity.userId, f.chat.id, 0))
      .filter((e) => e.type === 'request/snapshot')
      .at(-1)!;
    assert.equal(snapshotFactor(latest), 1);
  } finally {
    await runtime.close();
    await f.close();
  }
});
