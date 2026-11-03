import { NativeSecretBackend, SecretStore } from '@praxis/mcp-client/credentials';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PrivateKeyring } from './private-keyring.ts';

async function roundTrip() {
  let daemon = new PrivateKeyring();
  let store = new SecretStore(new NativeSecretBackend('auto'));
  const key = randomBytes(32).toString('hex');
  const value = 'disposable-凭据\nwith a final newline\n';
  try {
    await daemon.ready();
    assert.equal(await store.put(key, value), 'os');
    assert.equal(await store.get(key, 'os'), value, 'OS reads must preserve exact bytes.');
    await store.close();
    await daemon.stop();
    daemon = new PrivateKeyring();
    await daemon.ready();
    store = new SecretStore(new NativeSecretBackend('auto'));
    assert.equal(await store.get(key, 'os'), value, 'Credentials must survive service restart.');
    await store.delete(key, 'os');
    assert.equal(await store.get(key, 'os'), undefined);
    await store.delete(key, 'os');
  } finally {
    await store.close();
    await daemon.stop();
  }
}

async function limits() {
  const daemon = new PrivateKeyring();
  const store = new SecretStore(new NativeSecretBackend('auto'));
  const key = randomBytes(32).toString('hex');
  try {
    await daemon.ready();
    assert.equal(await store.put(key, 'a'.repeat(8192)), 'os');
    assert.equal((await store.get(key, 'os'))?.length, 8192);
    for (const large of ['b'.repeat(8193), '界'.repeat(2731)]) {
      const largeKey = randomBytes(32).toString('hex');
      const storage = await store.put(largeKey, large);
      assert.equal(
        (await store.get(largeKey, storage)) === large,
        true,
        'No backend may truncate a credential.',
      );
      assert.equal(storage, 'memory', 'The old secret-tool input limit must be explicit.');
      await assert.rejects(store.replace(key, large, 'os'), { code: 'SECRET_STORE_UNAVAILABLE' });
      assert.equal(await store.get(key, 'os'), 'a'.repeat(8192));
      await store.delete(largeKey, storage);
    }
    await store.delete(key, 'os');
  } finally {
    await store.close();
    await daemon.stop();
  }
}

async function main() {
  assert.equal(process.platform, 'linux');
  assert.equal(process.env.PRAXIS_TEST_PRIVATE_KEYRING, '1');
  if (process.argv[2] === 'round-trip') await roundTrip();
  else if (process.argv[2] === 'limits') await limits();
  else if (process.argv[2] === 'locked') await locked();
  else throw new Error('Unknown private keyring test case.');
}

async function locked() {
  let daemon = new PrivateKeyring();
  const store = new SecretStore(new NativeSecretBackend('auto'));
  const key = randomBytes(32).toString('hex');
  try {
    await daemon.ready();
    assert.equal(await store.put(key, 'private-lock-fixture'), 'os');
    await daemon.lock();
    await assert.rejects(store.get(key, 'os'), { code: 'SECRET_STORE_UNAVAILABLE' });
    await assert.rejects(store.replace(key, 'replacement', 'os'), {
      code: 'SECRET_STORE_UNAVAILABLE',
    });
    await daemon.stop();
    daemon = new PrivateKeyring();
    await daemon.ready();
    assert.equal(await store.get(key, 'os'), 'private-lock-fixture');
    await store.delete(key, 'os');
  } finally {
    await store.close();
    await daemon.stop();
  }
}
await main();
