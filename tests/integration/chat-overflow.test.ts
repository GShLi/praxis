import { PraxisError } from '@praxis/contracts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { chatFixture, finished, model } from './chat-fixture.ts';

async function send(f: Awaited<ReturnType<typeof chatFixture>>, text: string) {
  const done = finished(f.runtime, f.chat.id);
  await f.runtime.submit(f.identity.userId, f.chat.id, {
    requestId: crypto.randomUUID(),
    text,
    providerId: f.config.id,
    pageId: 'page',
  });
  return done;
}

test('Web generation recovers a pre-output overflow once with a new committed context and request snapshot', async () => {
  let ready = false,
    calls = 0,
    summaries = 0;
  const f = await chatFixture({
    async complete(request) {
      if (!ready) return model.complete(request);
      if (request.purpose === 'compaction') {
        summaries++;
        return model.complete(request);
      }
      calls++;
      if (calls === 1) throw new PraxisError('MODEL_CONTEXT_OVERFLOW', 'explicit overflow');
      assert.ok(request.messages.some((message) => message.content.startsWith('历史摘要')));
      assert.equal(request.messages.at(-1)?.content, '当前要求');
      return model.complete(request);
    },
  });
  try {
    await send(f, 'history '.repeat(100));
    await send(f, 'more history '.repeat(100));
    ready = true;
    const done = await send(f, '当前要求');
    assert.equal(done.payload.status, 'completed');
    assert.equal(calls, 2);
    assert.equal(summaries, 1);
    const events = await f.runtime.events(f.identity.userId, f.chat.id, 0);
    const requests = events.filter(
      (event) =>
        event.type === 'request/snapshot' &&
        event.payload.generationId === done.payload.generationId &&
        event.payload.purpose !== 'compaction',
    );
    assert.deepEqual(
      requests.map((event) => event.payload.contextVersion),
      [0, 1],
    );
    assert.equal((await f.runtime.history(f.identity.userId, f.chat.id)).inputs.length, 3);
  } finally {
    await f.close();
  }
});

test('Web never loops on repeated overflow or discards an already published partial answer', async () => {
  for (const partial of [false, true]) {
    let ready = false,
      calls = 0,
      summaries = 0;
    const f = await chatFixture({
      async complete(request) {
        if (!ready) return model.complete(request);
        if (request.purpose === 'compaction') {
          summaries++;
          return model.complete(request);
        }
        calls++;
        if (partial) request.onDelta('partial');
        throw new PraxisError('MODEL_CONTEXT_OVERFLOW', 'explicit overflow');
      },
    });
    try {
      await send(f, 'history '.repeat(100));
      ready = true;
      const done = await send(f, 'current');
      assert.equal(done.payload.status, 'failed');
      assert.equal(done.payload.content, partial ? 'partial' : '');
      assert.equal(calls, partial ? 1 : 2);
      assert.equal(summaries, partial ? 0 : 1);
    } finally {
      await f.close();
    }
  }
});
