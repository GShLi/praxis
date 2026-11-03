import { parseWorkspaceConfig } from '@praxis/config';
import { WorkspaceFiles } from '@praxis/tools/files';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('fixed workspace config read rejects links, oversized files, invalid UTF-8 and protected data', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-config-source-'));
  const config = path.join(root, '.praxis/config.json');
  const files = await WorkspaceFiles.open(root, () => 'unused');
  try {
    assert.equal(await files.readConfiguration(), null);
    await mkdir(path.dirname(config));
    await writeFile(config, '{"schemaVersion":1}');
    assert.equal(parseWorkspaceConfig(await files.readConfiguration()).value.schemaVersion, 1);
    await assert.rejects(files.readText(config, 32768), { code: 'ACCESS_DENIED' });
    await assert.rejects(files.resolve(config, true), { code: 'ACCESS_DENIED' });
    const protectedFiles = await WorkspaceFiles.open(root, () => 'unused', [path.dirname(config)]);
    await assert.rejects(protectedFiles.readConfiguration(), { code: 'ACCESS_DENIED' });
    await writeFile(config, ' '.repeat(32769));
    await assert.rejects(files.readConfiguration(), { code: 'WORKSPACE_CONFIG_LIMIT' });
    await writeFile(config, Buffer.from([0xff, 0xfe]));
    await assert.rejects(files.readConfiguration(), { code: 'WORKSPACE_CONFIG_INVALID' });
    await rm(config);
    await writeFile(path.join(root, 'outside.json'), '{"schemaVersion":1}');
    await symlink('../outside.json', config);
    await assert.rejects(files.readConfiguration(), { code: 'ACCESS_DENIED' });
    await assert.rejects(files.readConfiguration(AbortSignal.abort()), { name: 'AbortError' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('workspace parsing reports known schema paths without echoing invalid content or secrets', () => {
  assert.throws(() => parseWorkspaceConfig('{secret'), { code: 'WORKSPACE_CONFIG_INVALID' });
  assert.throws(
    () =>
      parseWorkspaceConfig(JSON.stringify({ schemaVersion: 1, context: { language: 'unknown' } })),
    /context.language/,
  );
  assert.throws(
    () => parseWorkspaceConfig(JSON.stringify({ schemaVersion: 1, ignore: ['bad\npattern'] })),
    /ignore.0/,
  );
  assert.throws(() => parseWorkspaceConfig(JSON.stringify({ schemaVersion: 2 })), /schemaVersion/);
  assert.throws(
    () =>
      parseWorkspaceConfig(
        JSON.stringify({ schemaVersion: 1, validationCommands: ['echo fixture-secret'] }),
        ['fixture-secret'],
      ),
    { code: 'WORKSPACE_CONFIG_SECRET' },
  );
  try {
    parseWorkspaceConfig(JSON.stringify({ schemaVersion: 1, 'secret-field': 'secret-value' }));
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes('secret-'));
  }
});
