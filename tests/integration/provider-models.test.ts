import assert from 'node:assert/strict';
import test from 'node:test';
import { databaseFixture, provider } from './fixture.ts';

test('multiple models share one encrypted credential and enforce per-model enablement and ownership', async () => {
  const f = await databaseFixture();
  try {
    const original = await f.auth.saveProvider(f.identity, provider, 'fixture-shared-key');
    const models = [
      {
        id: 'default',
        model: provider.model,
        contextWindow: 16000,
        maxOutputTokens: 1000,
        enabled: true,
      },
      {
        id: 'reasoning',
        model: 'fixture-reasoner',
        contextWindow: 64000,
        maxOutputTokens: 8000,
        enabled: true,
      },
    ];
    await f.auth.saveProvider(f.identity, { ...provider, models }, undefined, original.id, 1);
    const choice = original.id + ':reasoning';
    const config = await f.auth.beginUse(f.identity, choice, true);
    assert.equal(config.model, 'fixture-reasoner');
    assert.equal(config.contextWindow, 64000);
    assert.equal(config.apiKey, 'fixture-shared-key');
    assert.equal((await f.auth.beginUse(f.identity, original.id, true)).model, 'fixture');
    assert.equal((await f.database.query('SELECT id FROM provider_configs')).rowCount, 1);
    const listed = await f.auth.listProviders(f.identity);
    assert.equal(listed[0]?.models?.length, 2);
    assert.ok(!JSON.stringify(listed).includes('fixture-shared-key'));
    await assert.rejects(f.auth.beginUse(f.identity, original.id + ':missing', true), {
      code: 'PROVIDER_NOT_FOUND',
    });
    const other = await f.auth.createUser('other-model-user', 'fixture-password-long');
    await assert.rejects(f.auth.beginUse({ ...f.identity, userId: other.id }, choice, true), {
      code: 'PROVIDER_NOT_FOUND',
    });
    await f.auth.saveProvider(
      f.identity,
      { ...provider, models: [models[0]!, { ...models[1]!, enabled: false }] },
      'rotated-fixture-key',
      original.id,
      2,
    );
    await assert.rejects(f.auth.beginUse(f.identity, choice, true), { code: 'PROVIDER_NOT_FOUND' });
    assert.equal(
      (await f.auth.beginUse(f.identity, original.id, true)).apiKey,
      'rotated-fixture-key',
    );
    await f.auth.saveProvider(
      f.identity,
      { ...provider, name: 'Legacy client edit' },
      undefined,
      original.id,
      3,
    );
    const afterLegacyEdit = await f.auth.listProviders(f.identity);
    assert.equal(afterLegacyEdit[0]?.models?.length, 2);
    assert.equal(afterLegacyEdit[0]?.models?.[1]?.enabled, false);
    await assert.rejects(
      f.auth.saveProvider(
        f.identity,
        { ...provider, models, baseUrl: 'https://other.invalid' },
        undefined,
        original.id,
        4,
      ),
      { code: 'KEY_REQUIRED' },
    );
  } finally {
    await f.close();
  }
});
