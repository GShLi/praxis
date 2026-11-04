import { AgentRuntime } from '@praxis/agent-runtime';
import type { Session } from '@praxis/contracts';
import { SessionStore } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

const { sessionsRoutes } = (await import(
  new URL('../apps/agent-host/src/sessions-rpc.ts', import.meta.url).href
)) as {
  sessionsRoutes(
    identity: { require(): { store: SessionStore; runtime: AgentRuntime; owner: string } },
    clientKind: () => 'desktop',
  ): Record<string, (params: unknown) => unknown | Promise<unknown>>;
};

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-history-'));
  const store = new SessionStore(path.join(root, 'sessions.sqlite'));
  const runtime = new AgentRuntime(store, {
    model: {
      async complete() {
        throw new Error('No model expected');
      },
    },
    beginUse: async (_owner, signal) =>
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        if (signal.aborted) reject(signal.reason);
      }),
  });
  const identity = { require: () => ({ store, runtime, owner: 'owner' }) };
  const routes = sessionsRoutes(identity, () => 'desktop');
  const session = store.create('owner', 'chat');
  store.message(session.id, { id: 'message', role: 'user', content: 'preserve me' });
  t.after(async () => {
    await runtime.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const call = (method: string, params: unknown = {}) => {
    const handler = routes[method];
    assert(handler, `Missing route ${method}`);
    return Promise.resolve(handler(params));
  };
  return { store, runtime, session, call };
}

test('local history rename trims and persists title without changing raw history', async (t) => {
  const f = await fixture(t);
  const before = f.store.events(f.session.id);
  const renamed = (await f.call('session/rename', {
    sessionId: f.session.id,
    title: '  My chat \n',
  })) as Session;
  assert.equal(renamed.title, 'My chat');
  assert.equal(f.store.get(f.session.id, 'owner').title, 'My chat');
  assert.deepEqual(f.store.events(f.session.id), before);
  assert.equal(f.store.messages(f.session.id)[0]?.content, 'preserve me');
  assert.equal(renamed.createdAt, f.session.createdAt);
});

test('local history archive defaults true, lists metadata and restores without deleting history', async (t) => {
  const f = await fixture(t);
  const before = f.store.events(f.session.id);
  assert.equal(
    ((await f.call('session/archive', { sessionId: f.session.id })) as Session).archived,
    true,
  );
  assert.deepEqual(await f.call('session/list'), []);
  const all = (await f.call('session/list', { includeArchived: true })) as Session[];
  assert.equal(all.length, 1);
  assert.equal(all[0]?.createdAt, f.session.createdAt);
  assert.equal(all[0]?.archived, true);
  await f.call('session/archive', { sessionId: f.session.id, archived: false });
  const restored = (await f.call('session/list', { includeArchived: false })) as Session[];
  assert.equal(restored[0]?.archived, false);
  assert.equal(restored[0]?.id, f.session.id);
  assert.deepEqual(f.store.events(f.session.id), before);
  assert.equal(f.store.messages(f.session.id)[0]?.content, 'preserve me');
});

test('local history filters archived rows before the list limit and excludes other owners', async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 105; index++) {
    const session = f.store.create('owner', 'chat');
    f.store.update(session.id, { archived: true });
  }
  f.store.create('other', 'chat');
  const sessions = (await f.call('session/list')) as Session[];
  assert.deepEqual(
    sessions.map((session) => session.id),
    [f.session.id],
  );
  const all = (await f.call('session/list', { includeArchived: true })) as Session[];
  assert.equal(all.length, 100);
  assert.ok(all.every((session) => session.ownerUserId === 'owner'));
});

test('local history rejects cross-owner mutations and nonexistent sessions', async (t) => {
  const f = await fixture(t);
  const other = f.store.create('other', 'chat');
  for (const sessionId of [other.id, 'missing']) {
    await assert.rejects(f.call('session/rename', { sessionId, title: 'stolen' }), {
      code: 'SESSION_NOT_FOUND',
    });
    await assert.rejects(f.call('session/archive', { sessionId }), { code: 'SESSION_NOT_FOUND' });
    await assert.rejects(f.call('session/archive', { sessionId, archived: false }), {
      code: 'SESSION_NOT_FOUND',
    });
  }
  assert.deepEqual(f.store.get(other.id), other);
});

test('local history rejects empty, oversized or nonstring titles and accepts trimmed boundaries', async (t) => {
  const f = await fixture(t);
  for (const title of ['', ' \t\n', 'x'.repeat(201), null, 42]) {
    await assert.rejects(f.call('session/rename', { sessionId: f.session.id, title }), {
      name: 'ZodError',
    });
    assert.equal(f.store.get(f.session.id).title, f.session.title);
  }
  for (const title of [' a ', ' ' + 'x'.repeat(200) + ' ']) {
    const renamed = (await f.call('session/rename', { sessionId: f.session.id, title })) as Session;
    assert.equal(renamed.title, title.trim());
  }
  await assert.rejects(f.call('session/archive', { sessionId: f.session.id, archived: 'false' }), {
    name: 'ZodError',
  });
  await assert.rejects(f.call('session/list', { includeArchived: 'true' }), { name: 'ZodError' });
});

test('local history rejects mutations while a real turn is active', async (t) => {
  const f = await fixture(t);
  f.runtime.prompt('owner', { sessionId: f.session.id, requestId: 'active', text: 'wait' });
  await assert.rejects(f.call('session/archive', { sessionId: f.session.id }), {
    code: 'SESSION_BUSY',
  });
  await assert.rejects(f.call('session/rename', { sessionId: f.session.id, title: 'busy' }), {
    code: 'SESSION_BUSY',
  });
  await assert.rejects(f.call('session/archive', { sessionId: f.session.id, archived: false }), {
    code: 'SESSION_BUSY',
  });
  assert.equal(f.store.get(f.session.id).archived, false);
  assert.equal(f.store.get(f.session.id).title, f.session.title);
});
