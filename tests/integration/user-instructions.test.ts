import { createApp } from '@praxis/server/app';
import { UserInstructionRepository, migrate } from '@praxis/storage-server';
import assert from 'node:assert/strict';
import test from 'node:test';
import { chatFixture, finished, model } from './chat-fixture.ts';
import { provider } from './fixture.ts';

test('Web personal instructions API enforces account ownership and optimistic revisions', async () => {
  const f = await chatFixture();
  const app = createApp(f.auth, f.runtime, 'http://127.0.0.1:4310');
  const headers = {
    authorization: `Bearer ${f.login.accessToken}`,
    'content-type': 'application/json',
  };
  const route = '/v1/preferences/instructions';
  try {
    assert.equal((await (await app.request(route, { headers })).json()).revision, 0);
    const value = { enabled: true, text: 'FIRST WEB RULE' };
    assert.equal(
      (
        await app.request(route, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ expectedRevision: 0, value }),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await app.request(route, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ expectedRevision: 0, value }),
        })
      ).status,
      409,
    );
    const other = await f.auth.createUser('instructions-other', 'instructions-other-password');
    assert.equal((await new UserInstructionRepository(f.database).read(other.id)).revision, 0);
    const key = await f.auth.createApiKey(f.identity, 'readonly', ['chats:read'], 1);
    assert.equal(
      (
        await app.request(route, {
          method: 'PUT',
          headers: { ...headers, authorization: `Bearer ${key.key}` },
          body: JSON.stringify({ expectedRevision: 1, value }),
        })
      ).status,
      403,
    );
  } finally {
    await f.close();
  }
});

test('Web generations retain user instruction revisions independently of later settings edits', async () => {
  let expected = 'FIRST WEB RULE';
  const f = await chatFixture({
    async complete(request) {
      assert.ok(
        request.messages.some(
          (message) =>
            message.id.startsWith('user-instructions:') && message.content.includes(expected),
        ),
      );
      return model.complete(request);
    },
  });
  try {
    await new UserInstructionRepository(f.database).save(f.identity.userId, {
      expectedRevision: 0,
      value: { enabled: true, text: expected },
    });
    for (let turn = 0; turn < 2; turn++) {
      const done = finished(f.runtime, f.chat.id);
      await f.runtime.submit(f.identity.userId, f.chat.id, {
        requestId: crypto.randomUUID(),
        text: 'hello',
        providerId: f.config.id,
        pageId: 'page',
      });
      assert.equal((await done).payload.status, 'completed');
      expected = 'SECOND WEB RULE';
      if (turn === 0)
        await new UserInstructionRepository(f.database).save(f.identity.userId, {
          expectedRevision: 1,
          value: { enabled: true, text: expected },
        });
    }
    const events = await f.runtime.events(f.identity.userId, f.chat.id, 0);
    const snapshots = events.filter((event) => event.type === 'user-instructions/snapshot');
    assert.deepEqual(
      snapshots.map((event) => event.payload.revision),
      [1, 2],
    );
    assert.equal(snapshots[0]?.payload.content, 'FIRST WEB RULE');
  } finally {
    await f.close();
  }
});

test('the second migration upgrades an existing database without losing accounts and refuses a running server', async () => {
  const f = await chatFixture();
  const lease = await f.database.pool.connect();
  try {
    await f.database.query('DROP TABLE user_instructions');
    await f.database.query('DELETE FROM schema_migrations WHERE version=2');
    await lease.query('SELECT pg_advisory_lock(707261786974)');
    await assert.rejects(migrate(f.database), { code: 'SERVER_ALREADY_RUNNING' });
    await lease.query('SELECT pg_advisory_unlock(707261786974)');
    await migrate(f.database);
    assert.equal((await f.auth.authenticate(f.login.accessToken)).userId, f.identity.userId);
    assert.equal(
      (await new UserInstructionRepository(f.database).read(f.identity.userId)).revision,
      0,
    );
    await f.database.query("UPDATE schema_migrations SET checksum='modified' WHERE version=2");
    await assert.rejects(migrate(f.database), { code: 'MIGRATION_CONFLICT' });
  } finally {
    lease.release();
    await f.close();
  }
});

test('current Web instructions survive repeated compaction without entering the summary source', async () => {
  let summaries = 0;
  const personal = 'CURRENT PERSONAL RULE';
  const f = await chatFixture({
    async complete(request) {
      if (request.purpose === 'compaction') {
        summaries++;
        assert.ok(!JSON.stringify(request.messages).includes(personal));
      } else
        assert.ok(
          request.messages.some(
            (message) =>
              message.id.startsWith('user-instructions:') && message.content.includes(personal),
          ),
        );
      return model.complete(request);
    },
  });
  try {
    await new UserInstructionRepository(f.database).save(f.identity.userId, {
      expectedRevision: 0,
      value: { enabled: true, text: personal },
    });
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
    assert.ok(summaries >= 2);
    assert.equal((await f.runtime.history(f.identity.userId, f.chat.id)).inputs.length, 24);
  } finally {
    await f.close();
  }
});

test('oversized fixed Web instructions reject before spending an additional model or compaction attempt', async () => {
  let calls = 0;
  const f = await chatFixture({
    async complete(request) {
      calls++;
      return model.complete(request);
    },
  });
  async function send(text: string) {
    const done = finished(f.runtime, f.chat.id);
    await f.runtime.submit(f.identity.userId, f.chat.id, {
      requestId: crypto.randomUUID(),
      text,
      providerId: f.config.id,
      pageId: 'page',
    });
    return done;
  }
  try {
    for (let i = 0; i < 2; i++)
      assert.equal((await send('fact'.repeat(600))).payload.status, 'completed');
    await f.auth.saveProvider(
      f.identity,
      { ...provider, contextWindow: 8192 },
      undefined,
      f.config.id,
      1,
    );
    await new UserInstructionRepository(f.database).save(f.identity.userId, {
      expectedRevision: 0,
      value: { enabled: true, text: 'x'.repeat(16000) },
    });
    calls = 0;
    assert.equal((await send('next')).payload.status, 'failed');
    assert.equal(calls, 0);
    const events = await f.runtime.events(f.identity.userId, f.chat.id, 0);
    assert.ok(
      events.some(
        (event) =>
          event.type === 'generation/error' && event.payload.code === 'CONTEXT_FIXED_TOO_LARGE',
      ),
    );
  } finally {
    await f.close();
  }
});
