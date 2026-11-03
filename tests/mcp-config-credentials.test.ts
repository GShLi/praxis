import { PraxisError } from '@praxis/contracts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { oauthProfile } from './fixtures/oauth-profile.ts';

test('editing preserves only local credentials for the same endpoint; moving endpoints clears the old secret', async () => {
  const f = await oauthProfile();
  try {
    const state = await f.credentials.setBearer(f.config.id, 1, 1, 'fixture-bearer');
    const saved = await f.credentials.saveConfig(
      {
        ...state.value[0],
        displayName: 'Edited',
        transport: {
          ...f.config.transport,
          auth: { type: 'bearer', credentialRef: 'untrusted-import' },
        },
      },
      2,
      2,
    );
    assert.equal(saved.value[0]?.displayName, 'Edited');
    assert.equal(
      (await f.credentials.resolve(saved.value[0]!, AbortSignal.timeout(1000))).bearer,
      'fixture-bearer',
    );
    assert.equal(f.values.size, 1);
    assert.equal(saved.value[0]?.enabled, false);
    const moved = await f.credentials.saveConfig(
      {
        ...saved.value[0],
        transport: { ...f.config.transport, endpoint: 'https://changed.invalid/mcp' },
      },
      saved.revision,
      saved.value[0]!.revision,
    );
    assert.deepEqual(await f.credentials.resolve(moved.value[0]!, AbortSignal.timeout(1000)), {
      authEpoch: 0,
    });
    assert.equal(f.values.size, 0);
    const deleted = await f.credentials.deleteConfig(
      f.config.id,
      moved.revision,
      moved.value[0]!.revision,
    );
    assert.equal(deleted.value.length, 0);
  } finally {
    await f.close();
  }
});

test('failed secret deletion keeps the server disabled with its cleanup reference, allowing a safe retry', async () => {
  const f = await oauthProfile();
  try {
    await f.credentials.setBearer(f.config.id, 1, 1, 'fixture-bearer');
    const remove = f.backend.delete;
    f.backend.delete = async () => {
      throw new PraxisError('SECRET_STORE_UNAVAILABLE', 'fixture');
    };
    await assert.rejects(f.credentials.deleteConfig(f.config.id, 2, 2), {
      code: 'SECRET_STORE_UNAVAILABLE',
    });
    const failed = await f.configs.file.read();
    assert.equal(failed.value.length, 1);
    assert.equal(failed.value[0]?.enabled, false);
    assert.equal(f.values.size, 1);
    f.backend.delete = remove;
    const deleted = await f.credentials.deleteConfig(
      f.config.id,
      failed.revision,
      failed.value[0]!.revision,
    );
    assert.equal(deleted.value.length, 0);
    assert.equal(f.values.size, 0);
  } finally {
    await f.close();
  }
});

test('deleting a pending OAuth configuration cancels the callback before removing the configuration', async () => {
  const f = await oauthProfile();
  try {
    const started = await f.credentials.oauth.start(f.input);
    await f.credentials.deleteConfig(f.config.id, 1, 1);
    assert.equal((await f.credentials.oauth.wait(started.id)).status, 'cancelled');
    await assert.rejects(fetch(f.input.redirectUri));
    assert.equal((await f.configs.file.read()).value.length, 0);
    assert.equal(f.values.size, 0);
  } finally {
    await f.close();
  }
});
