import { UserInstructionConfig } from '@praxis/config/user-instructions';
import { userInstructionMaterial } from '@praxis/context';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('personal settings serialize conflicting saves, validate UTF-8 budgets and drain before closing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-personal-config-'));
  const settings = new UserInstructionConfig(root),
    request = { expectedRevision: 0, value: { enabled: true, text: '用中文回复' } };
  try {
    assert.equal((await settings.read()).revision, 0);
    const results = await Promise.allSettled([settings.save(request), settings.save(request)]);
    assert.deepEqual(
      results.map((result) => result.status),
      ['fulfilled', 'rejected'],
    );
    assert.equal((await settings.read()).revision, 1);
    assert.throws(() =>
      settings.save({ expectedRevision: 1, value: { enabled: true, text: '中'.repeat(6000) } }),
    );
    assert.throws(() => settings.save({ ...request, command: 'run arbitrary code' }));
    const saving = settings.save({
      expectedRevision: 1,
      value: { enabled: false, text: '用中文回复' },
    });
    await settings.close();
    await saving;
    assert.throws(() => settings.save(request), { code: 'CONFIG_CLOSED' });
    const reopened = new UserInstructionConfig(root);
    try {
      assert.equal((await reopened.read()).revision, 2);
    } finally {
      await reopened.close();
    }
  } finally {
    await settings.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('known credentials never enter personal request material and disabling omits the configured text', () => {
  const settings = { revision: 7, value: { enabled: true, text: 'private-vendor-key' } };
  assert.throws(() => userInstructionMaterial(settings, ['private-vendor-key']), {
    code: 'INSTRUCTION_SECRET',
  });
  const disabled = userInstructionMaterial(
    { ...settings, value: { ...settings.value, enabled: false } },
    ['private-vendor-key'],
  );
  assert.deepEqual(disabled.messages, []);
  assert.equal(disabled.text, '');
  assert.ok(!JSON.stringify(disabled).includes('private-vendor-key'));
});
