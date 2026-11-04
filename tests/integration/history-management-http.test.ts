import { createApp } from '@praxis/server/app';
import type { ModelClient } from '@praxis/model-core';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { chatFixture, finished } from './chat-fixture.ts';

const origin = 'http://127.0.0.1:4310';
interface ChatRow {
  id: string;
  title: string;
  archived: boolean;
  created_at: string;
}

async function fixture(t: TestContext, model?: ModelClient) {
  const f = await chatFixture(model);
  t.after(() => f.close());
  const app = createApp(f.auth, f.runtime, origin);
  const login = await f.auth.login(f.identity.username, 'fixture-password-123', 'web');
  const headers = {
    cookie: `praxis_session=${login.accessToken}`,
    origin,
    'x-csrf-token': login.csrfToken,
    'content-type': 'application/json',
  };
  const patch = (body: unknown, id = f.chat.id, requestHeaders = headers) =>
    app.request(`/v1/chats/${id}`, {
      method: 'PATCH',
      headers: requestHeaders,
      body: JSON.stringify(body),
    });
  const list = async (query = '') => {
    const response = await app.request('/v1/chats' + query, { headers });
    assert.equal(response.status, 200);
    return response.json() as Promise<ChatRow[]>;
  };
  return { ...f, app, headers, patch, list };
}

test('Web history rename/archive/restore persists metadata while preserving raw conversation', async (t) => {
  const f = await fixture(t);
  const done = finished(f.runtime, f.chat.id);
  await f.runtime.submit(f.identity.userId, f.chat.id, {
    requestId: crypto.randomUUID(),
    text: 'preserve me',
    providerId: f.config.id,
    pageId: 'page',
  });
  await done;
  const before = await f.runtime.history(f.identity.userId, f.chat.id);
  const events = await f.runtime.events(f.identity.userId, f.chat.id, 0);
  const response = await f.patch({ title: '  Renamed \n', archived: true });
  assert.equal(response.status, 200);
  const updated = (await response.json()) as ChatRow;
  assert.equal(updated.title, 'Renamed');
  assert.equal(updated.archived, true);
  assert.equal(new Date(updated.created_at).toISOString(), updated.created_at);
  assert.deepEqual(await f.list(), []);
  assert.deepEqual(await f.list('?includeArchived=false'), []);
  const archived = await f.list('?includeArchived=true');
  assert.equal(archived[0]?.id, f.chat.id);
  assert.equal(archived[0]?.archived, true);
  assert.equal(archived[0]?.created_at, updated.created_at);
  const history = await f.app.request(`/v1/chats/${f.chat.id}/history`, { headers: f.headers });
  assert.equal(history.status, 200);
  assert.deepEqual((await history.json()).inputs, before.inputs);
  const restored = await f.patch({ archived: false });
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).title, 'Renamed');
  assert.equal((await f.list())[0]?.archived, false);
  const after = await f.runtime.history(f.identity.userId, f.chat.id);
  assert.deepEqual(after.inputs, before.inputs);
  assert.deepEqual(after.generations, before.generations);
  assert.deepEqual(await f.runtime.events(f.identity.userId, f.chat.id, 0), events);
});

test('Web history mutations and archived lists cannot access another account', async (t) => {
  const f = await fixture(t);
  const other = await f.auth.createUser('other-owner', 'other-password-123');
  const chat = await f.runtime.create(other.id);
  for (const id of [chat.id, 'missing']) {
    for (const body of [{ title: 'stolen' }, { archived: true }, { archived: false }]) {
      const response = await f.patch(body, id);
      assert.equal(response.status, 404);
      assert.equal((await response.json()).code, 'SESSION_NOT_FOUND');
    }
  }
  assert.deepEqual(await f.runtime.owned(other.id, chat.id), chat);
  const listed = await f.list('?includeArchived=true');
  assert.deepEqual(
    listed.map((row) => row.id),
    [f.chat.id],
  );
});

test('Web history PATCH enforces authentication, write scope, Origin and CSRF', async (t) => {
  const f = await fixture(t);
  const url = `/v1/chats/${f.chat.id}`;
  assert.equal((await f.app.request(url, { method: 'PATCH', body: '{}' })).status, 401);
  for (const headers of [
    { ...f.headers, 'x-csrf-token': '' },
    { ...f.headers, 'x-csrf-token': 'wrong' },
    { ...f.headers, origin: 'https://other.invalid' },
    { ...f.headers, origin: '' },
  ])
    assert.equal((await f.patch({ archived: true }, f.chat.id, headers)).status, 403);
  const key = await f.auth.createApiKey(f.identity, 'read-only', ['chats:read'], 1);
  const token = await f.auth.exchange(await f.auth.authenticate(key.key));
  const denied = await f.app.request(url, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'denied' }),
  });
  assert.equal(denied.status, 403);
  assert.deepEqual(await f.runtime.owned(f.identity.userId, f.chat.id), f.chat);
});

test('Web history rejects malformed updates atomically and trims accepted title boundaries', async (t) => {
  const f = await fixture(t);
  for (const body of [
    {},
    { title: '' },
    { title: ' \t\n', archived: true },
    { title: 'x'.repeat(201) },
    { title: 42 },
    { title: null },
    { archived: 'false' },
    { archived: null },
    { extra: true },
  ]) {
    const response = await f.patch(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal((await response.json()).code, 'INVALID_ARGUMENT');
  }
  assert.deepEqual(await f.runtime.owned(f.identity.userId, f.chat.id), f.chat);
  for (const title of [' a ', ' ' + 'x'.repeat(200) + ' ']) {
    const response = await f.patch({ title });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).title, title.trim());
  }
  const badQuery = await f.app.request('/v1/chats?includeArchived=anything', {
    headers: f.headers,
  });
  assert.equal(badQuery.status, 400);
});

test('Web history rejects all metadata changes during an active generation', async (t) => {
  const f = await fixture(t, {
    complete: async ({ signal }) =>
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        if (signal.aborted) reject(signal.reason);
      }),
  });
  const done = finished(f.runtime, f.chat.id);
  const accepted = await f.runtime.submit(f.identity.userId, f.chat.id, {
    requestId: crypto.randomUUID(),
    text: 'wait',
    providerId: f.config.id,
    pageId: 'page',
  });
  for (const body of [
    { archived: true },
    { title: 'busy' },
    { title: 'busy', archived: true },
    { archived: false },
  ]) {
    const response = await f.patch(body);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'SESSION_BUSY');
  }
  const busy = await f.runtime.owned(f.identity.userId, f.chat.id);
  assert.equal(busy.title, 'wait');
  assert.equal(busy.archived, false);
  await f.runtime.cancel(f.identity.userId, f.chat.id, accepted.generationId);
  await done;
  assert.equal((await f.patch({ archived: true })).status, 200);
});

test('Web history concurrent rename and archive retain both committed changes', async (t) => {
  const f = await fixture(t);
  const responses = await Promise.all([
    f.patch({ title: 'Concurrent title' }),
    f.patch({ archived: true }),
  ]);
  assert.ok(responses.every((response) => response.status === 200));
  const stored = await f.runtime.owned(f.identity.userId, f.chat.id);
  assert.equal(stored.title, 'Concurrent title');
  assert.equal(stored.archived, true);
  assert.equal((await f.patch({ archived: true })).status, 200);
  assert.equal((await f.patch({ archived: false })).status, 200);
  assert.equal((await f.patch({ archived: false })).status, 200);
  assert.equal((await f.list())[0]?.title, 'Concurrent title');
});
