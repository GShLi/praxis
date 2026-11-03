import { SecretStore, type SecretBackend } from '@praxis/mcp-client/credentials';
import { PraxisError } from '@praxis/contracts';
import assert from 'node:assert/strict';
import test from 'node:test';

function backend(available = true) {
  const values = new Map<string, string>();
  const check = () => {
    if (!available) throw new PraxisError('SECRET_STORE_UNAVAILABLE', 'fixture');
  };
  const native: SecretBackend = {
    async set(key, value) {
      check();
      values.set(key, value);
    },
    async get(key) {
      check();
      return values.get(key);
    },
    async delete(key) {
      check();
      values.delete(key);
    },
  };
  return { native, values };
}
test('MCP secrets persist only through the OS backend and memory fallback expires at close', async () => {
  for (const available of [true, false]) {
    const f = backend(available),
      store = new SecretStore(f.native);
    const key = 'a'.repeat(64),
      value = 'fake-credential';
    const storage = await store.put(key, value);
    assert.equal(storage, available ? 'os' : 'memory');
    assert.equal(await store.get(key, storage), value);
    await store.close();
    await assert.rejects(store.get(key, storage), { code: 'SECRET_STORE_CLOSED' });
    const reopened = new SecretStore(f.native);
    if (available) {
      assert.equal(await reopened.get(key, storage), value);
      await reopened.delete(key, storage);
      assert.equal(f.values.size, 0);
    } else assert.equal(await reopened.get(key, storage), undefined);
    await reopened.close();
  }
});

test('closing MCP secret storage cancels in-flight writes instead of publishing a memory fallback', async () => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const store = new SecretStore({
    set: async (_key, _value, signal) =>
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        started();
      }),
    get: async () => undefined,
    delete: async () => {},
  });
  const pending = store.put('b'.repeat(64), 'fake');
  const cancelled = assert.rejects(pending, { code: 'SECRET_STORE_CLOSED' });
  await ready;
  await store.close();
  await cancelled;
});
