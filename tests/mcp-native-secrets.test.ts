import { NativeSecretBackend, SecretStore } from '@praxis/mcp-client/credentials';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';

test(
  'native credential backend round trip uses a disposable namespace without authentication UI',
  { skip: process.env.PRAXIS_TEST_NATIVE_SECRETS !== '1' },
  async (t) => {
    const store = new SecretStore(new NativeSecretBackend('auto'));
    const key = createHash('sha256')
      .update('praxis-test-' + randomUUID())
      .digest('hex');
    let storage: 'os' | 'memory' | undefined;
    try {
      storage = await store.put(key, 'fake-disposable-credential');
      t.diagnostic(
        `${process.platform}: ${storage === 'os' ? 'OS storage verified' : 'OS unavailable; explicit memory fallback verified'}`,
      );
      assert.equal(await store.get(key, storage), 'fake-disposable-credential');
      await store.delete(key, storage);
      assert.equal(await store.get(key, storage), undefined);
    } finally {
      if (storage) await store.delete(key, storage);
      await store.close();
    }
  },
);
