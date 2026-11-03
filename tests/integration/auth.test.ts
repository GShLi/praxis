import { migrate } from '@praxis/storage-server';
import assert from 'node:assert/strict';
import test from 'node:test';
import { databaseFixture, provider } from './fixture.ts';

test('real PostgreSQL migration is repeatable and credential rotation revokes reused refresh families', async () => {
  const f = await databaseFixture();
  try {
    await migrate(f.database);
    assert.equal((await f.database.query('SELECT version FROM schema_migrations')).rowCount, 2);
    const rotated = await f.auth.refresh(f.login.refreshToken, false);
    await f.auth.authenticate(rotated.accessToken);
    await assert.rejects(f.auth.refresh(f.login.refreshToken, false), { code: 'UNAUTHENTICATED' });
    await assert.rejects(f.auth.authenticate(rotated.accessToken), { code: 'UNAUTHENTICATED' });
  } finally {
    await f.close();
  }
});
test('real PostgreSQL provider revisions, ownership, encrypted keys and API scopes are enforced', async () => {
  const f = await databaseFixture();
  try {
    const saved = await f.auth.saveProvider(f.identity, provider, 'fixture-vendor-key');
    const raw = await f.database.query('SELECT encrypted_key FROM provider_configs');
    assert.ok(!JSON.stringify(raw.rows).includes('fixture-vendor-key'));
    await assert.rejects(f.auth.saveProvider(f.identity, provider, undefined, saved.id, 0), {
      code: 'CONFIG_CONFLICT',
    });
    const other = await f.auth.createUser('other-fixture', 'other-fixture-password');
    await assert.rejects(f.auth.beginUse({ ...f.identity, userId: other.id }, saved.id, true), {
      code: 'PROVIDER_NOT_FOUND',
    });
    const updated = await f.auth.saveProvider(
      f.identity,
      { ...provider, name: 'Updated' },
      undefined,
      saved.id,
      1,
    );
    assert.equal(updated.revision, 2);
    assert.equal((await f.auth.beginUse(f.identity, saved.id, true)).apiKey, 'fixture-vendor-key');
    const key = await f.auth.createApiKey(f.identity, 'limited', ['profile:read'], 1);
    const limited = await f.auth.authenticate(key.key);
    await assert.rejects(f.auth.beginUse(limited, saved.id, true), { code: 'FORBIDDEN' });
    await f.auth.revokeApiKey(f.identity, key.id);
    await assert.rejects(f.auth.authenticate(key.key), { code: 'UNAUTHENTICATED' });
  } finally {
    await f.close();
  }
});

test('changing a model adapter requires a new credential and preserves the explicit adapter through begin-use', async () => {
  const f = await databaseFixture();
  try {
    const saved = await f.auth.saveProvider(f.identity, provider, 'fixture-vendor-key');
    const custom = { ...provider, adapter: 'fixture.provider/custom' };
    await assert.rejects(f.auth.saveProvider(f.identity, custom, undefined, saved.id, 1), {
      code: 'KEY_REQUIRED',
    });
    await f.auth.saveProvider(f.identity, custom, 'new-plugin-key', saved.id, 1);
    const config = await f.auth.beginUse(f.identity, saved.id, true);
    assert.equal(config.adapter, 'fixture.provider/custom');
    assert.equal(config.apiKey, 'new-plugin-key');
    await assert.rejects(
      f.auth.providerDiscoveryCredentials(f.identity, {
        id: saved.id,
        expectedRevision: 2,
        baseUrl: provider.baseUrl,
      }),
      { code: 'MODEL_CATALOG_UNSUPPORTED' },
    );
  } finally {
    await f.close();
  }
});
