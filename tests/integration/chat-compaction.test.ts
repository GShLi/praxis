import { budget, estimate } from '@praxis/context';
import type { ModelClient } from '@praxis/model-core';
import assert from 'node:assert/strict';
import test from 'node:test';
import { chatFixture, finished, model } from './chat-fixture.ts';
import { provider } from './fixture.ts';

async function send(f: Awaited<ReturnType<typeof chatFixture>>, text: string) {
  const done = finished(f.runtime, f.chat.id);
  const accepted = await f.runtime.submit(f.identity.userId, f.chat.id, {
    requestId: crypto.randomUUID(),
    text,
    providerId: f.config.id,
    pageId: 'page',
  });
  return { done, generationId: accepted.generationId };
}
async function largeHistory(client: ModelClient, turns: number) {
  const f = await chatFixture(client);
  try {
    await f.auth.saveProvider(
      f.identity,
      { ...provider, contextWindow: 128000 },
      undefined,
      f.config.id,
      1,
    );
    for (let i = 0; i < turns; i++)
      assert.equal(
        (await (await send(f, `${i}:` + 'detail '.repeat(200))).done).payload.status,
        'completed',
      );
    await f.auth.saveProvider(
      f.identity,
      { ...provider, contextWindow: 8192 },
      undefined,
      f.config.id,
      2,
    );
    return f;
  } catch (error) {
    await f.close();
    throw error;
  }
}

test('Web compaction chunks large-window history before continuing with a smaller model window', async () => {
  let summaries = 0;
  const f = await largeHistory(
    {
      async complete(request) {
        if (request.purpose === 'compaction') {
          summaries++;
          assert.ok(estimate(request.messages) < budget(request.config).available);
        }
        return model.complete(request);
      },
    },
    12,
  );
  const published: number[] = [];
  f.runtime.on('event', (event) => {
    if (event.type === 'context/compaction_committed') published.push(event.payload.version);
  });
  try {
    assert.equal((await (await send(f, '继续当前任务')).done).payload.status, 'completed');
    assert.ok(summaries >= 2 && summaries <= 8);
    assert.equal((await f.database.query('SELECT version FROM chat_contexts')).rowCount, 1);
    assert.deepEqual(published, [1]);
    assert.equal((await f.runtime.history(f.identity.userId, f.chat.id)).inputs.length, 13);
  } finally {
    await f.close();
  }
});

test('a stale Web summary cannot replace a newer source view', async () => {
  let replaceView: (() => Promise<void>) | undefined;
  const f = await largeHistory(
    {
      async complete(request) {
        if (request.purpose === 'compaction' && replaceView) {
          const replace = replaceView;
          replaceView = undefined;
          await replace();
        }
        return model.complete(request);
      },
    },
    4,
  );
  try {
    const firstInput = (await f.runtime.history(f.identity.userId, f.chat.id)).inputs[0]!;
    replaceView = async () => {
      await f.database.query(
        'INSERT INTO chat_contexts(session_id,version,summary,source_ids,through_input) VALUES($1,1,$2,$3,$4)',
        [
          f.chat.id,
          JSON.stringify({ id: 'newer', role: 'user', content: 'newer view' }),
          JSON.stringify([firstInput.id]),
          firstInput.id,
        ],
      );
    };
    assert.equal((await (await send(f, '继续')).done).payload.status, 'failed');
    const contexts = await f.database.query('SELECT version,summary FROM chat_contexts');
    assert.equal(contexts.rowCount, 1);
    assert.equal(contexts.rows[0]!.summary.id, 'newer');
  } finally {
    await f.close();
  }
});

test('PostgreSQL cancels after the body completes but before issuing COMMIT', async () => {
  const f = await chatFixture();
  const controller = new AbortController();
  try {
    await assert.rejects(
      f.database.transaction(async (sql) => {
        await sql.query('UPDATE chats SET title=$1 WHERE id=$2', ['must roll back', f.chat.id]);
        controller.abort();
      }, controller.signal),
      { name: 'AbortError' },
    );
    const history = await f.runtime.history(f.identity.userId, f.chat.id);
    assert.equal(history.chat.title, f.chat.title);
  } finally {
    await f.close();
  }
});

test('cancelling while a Web compaction waits to enter its transaction never commits the candidate', async () => {
  let intercept = false,
    entered: (() => void) | undefined,
    release: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await largeHistory(
    {
      async complete(request) {
        if (request.purpose === 'compaction') intercept = true;
        return model.complete(request);
      },
    },
    4,
  );
  const transaction = f.database.transaction.bind(f.database);
  f.database.transaction = async (body) => {
    if (!intercept) return transaction(body);
    intercept = false;
    return transaction(async (sql) => {
      entered?.();
      await gate;
      return body(sql);
    });
  };
  try {
    const running = await send(f, '继续');
    await ready;
    await f.runtime.cancel(f.identity.userId, f.chat.id, running.generationId);
    release?.();
    assert.equal((await running.done).payload.status, 'interrupted');
    assert.equal((await f.database.query('SELECT version FROM chat_contexts')).rowCount, 0);
  } finally {
    release?.();
    await f.close();
  }
});
