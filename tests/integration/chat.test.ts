import assert from 'node:assert/strict';
import test from 'node:test';
import { chatFixture, finished, model } from './chat-fixture.ts';

test('PostgreSQL Chat serializes duplicate input, keeps selected generations and persists checkpoints', async () => {
  const f = await chatFixture();
  try {
    const request = {
      requestId: crypto.randomUUID(),
      text: 'Hello',
      providerId: f.config.id,
      pageId: 'page',
    };
    const done = finished(f.runtime, f.chat.id);
    const [first, duplicate] = await Promise.all([
      f.runtime.submit(f.identity.userId, f.chat.id, request),
      f.runtime.submit(f.identity.userId, f.chat.id, request),
    ]);
    assert.equal(first.generationId, duplicate.generationId);
    assert.equal((await done).payload.status, 'completed');
    const history = await f.runtime.history(f.identity.userId, f.chat.id);
    assert.equal(history.inputs.length, 1);
    assert.equal(history.generations.length, 1);
    assert.equal(history.inputs[0]?.selected_generation, first.generationId);
    await assert.rejects(
      f.runtime.submit(f.identity.userId, f.chat.id, { ...request, text: 'Different' }),
      { code: 'REQUEST_CONFLICT' },
    );
    const regenerated = finished(f.runtime, f.chat.id);
    await f.runtime.submit(
      f.identity.userId,
      f.chat.id,
      { ...request, requestId: crypto.randomUUID() },
      true,
    );
    assert.equal((await regenerated).payload.status, 'completed');
    const next = await f.runtime.history(f.identity.userId, f.chat.id);
    assert.equal(next.inputs.length, 1);
    assert.equal(next.generations.length, 2);
    assert.equal((await f.database.query('SELECT * FROM chat_checkpoints')).rowCount, 2);
    const snapshots = await f.database.query('SELECT document FROM chat_events');
    assert.ok(!JSON.stringify(snapshots).includes('fixture-vendor-key'));
  } finally {
    await f.close();
  }
});

test('Chat close cancels model work, persists interruption, and rejects subsequent submissions', async () => {
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const f = await chatFixture({
    async complete(request) {
      request.onDelta('partial');
      entered();
      await new Promise<void>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(request.signal.reason), {
          once: true,
        });
        if (request.signal.aborted) reject(request.signal.reason);
      });
      return model.complete(request);
    },
  });
  try {
    const request = {
      requestId: crypto.randomUUID(),
      text: 'wait',
      providerId: f.config.id,
      pageId: 'page',
    };
    const done = finished(f.runtime, f.chat.id);
    await f.runtime.submit(f.identity.userId, f.chat.id, request);
    await ready;
    await f.runtime.close();
    const event = await done;
    assert.equal(event.payload.status, 'interrupted');
    assert.equal(event.payload.content, 'partial');
    const history = await f.runtime.history(f.identity.userId, f.chat.id);
    assert.equal(history.chat.active_generation, null);
    await assert.rejects(
      f.runtime.submit(f.identity.userId, f.chat.id, {
        ...request,
        requestId: crypto.randomUUID(),
      }),
      { code: 'SERVER_CLOSING' },
    );
  } finally {
    await f.close();
  }
});

test('repeated PostgreSQL Chat compaction retains all raw input and generation records', async () => {
  const f = await chatFixture();
  try {
    for (let i = 0; i < 24; i++) {
      const done = finished(f.runtime, f.chat.id);
      await f.runtime.submit(f.identity.userId, f.chat.id, {
        requestId: crypto.randomUUID(),
        text: `${i}:` + 'detail '.repeat(160),
        providerId: f.config.id,
        pageId: 'page',
      });
      assert.equal((await done).payload.status, 'completed');
    }
    const contexts = await f.database.query('SELECT * FROM chat_contexts');
    assert.ok(contexts.rows.length >= 2);
    const history = await f.runtime.history(f.identity.userId, f.chat.id);
    assert.equal(history.inputs.length, 24);
    assert.equal(history.generations.length, 24);
    assert.equal(history.inputs.at(-1)?.content.startsWith('23:'), true);
  } finally {
    await f.close();
  }
});

test('closing during input acceptance never starts model work after shutdown', async () => {
  let calls = 0;
  const f = await chatFixture({
    async complete(request) {
      calls++;
      return model.complete(request);
    },
  });
  let release!: () => void, accepted!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    accepted = resolve;
  });
  const transaction = f.database.transaction.bind(f.database);
  let intercept = true;
  f.database.transaction = async (body) => {
    const result = await transaction(body);
    if (intercept) {
      intercept = false;
      accepted();
      await gate;
    }
    return result;
  };
  try {
    const submission = f.runtime.submit(f.identity.userId, f.chat.id, {
      requestId: crypto.randomUUID(),
      text: 'late acceptance',
      providerId: f.config.id,
      pageId: 'page',
    });
    await ready;
    const closing = f.runtime.close();
    release();
    await submission;
    await closing;
    assert.equal(calls, 0);
    const state = await f.runtime.history(f.identity.userId, f.chat.id);
    assert.equal(state.chat.active_generation, null);
    assert.equal(state.generations[0]?.status, 'interrupted');
    assert.equal(calls, 0);
  } finally {
    release();
    await f.close();
  }
});
