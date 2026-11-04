import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { copyDependencies } from '../scripts/release/dependencies.ts';

test('release copies transitive production dependencies without workspace links', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'praxis-release-deps-'));
  try {
    const source = path.join(root, 'source');
    const store = path.join(root, 'store/a');
    const output = path.join(root, 'output');
    await mkdir(path.join(source, 'node_modules'), { recursive: true });
    await mkdir(path.join(store, 'node_modules/b'), { recursive: true });
    await writeFile(
      path.join(source, 'package.json'),
      JSON.stringify({ dependencies: { a: '1.0.0' } }),
    );
    await writeFile(
      path.join(store, 'package.json'),
      JSON.stringify({
        name: 'a',
        version: '1.0.0',
        dependencies: { b: '1.0.0' },
        devDependencies: { missing: '*' },
      }),
    );
    await writeFile(
      path.join(store, 'node_modules/b/package.json'),
      JSON.stringify({ name: 'b', version: '1.0.0' }),
    );
    await symlink(store, path.join(source, 'node_modules/a'), 'junction');
    const inventory = await copyDependencies(source, output, ['a']);
    await rm(source, { recursive: true });
    await rm(path.join(root, 'store'), { recursive: true });
    assert.equal(
      JSON.parse(
        await readFile(path.join(output, 'node_modules/a/node_modules/b/package.json'), 'utf8'),
      ).name,
      'b',
    );
    assert.deepEqual(inventory.map((item) => item.name).sort(), ['a', 'b']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('release fails if a required production dependency is missing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'praxis-release-missing-'));
  try {
    await assert.rejects(
      copyDependencies(root, path.join(root, 'out'), ['missing-praxis-dependency']),
      /Missing production dependency/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('release rejects dependency links to private files outside its package', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'praxis-release-link-'));
  try {
    const directory = path.join(root, 'node_modules/a');
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({ name: 'a', version: '1.0.0' }),
    );
    const outside = path.join(root, 'private');
    await mkdir(outside);
    await symlink(outside, path.join(directory, 'leak'), 'junction');
    await assert.rejects(
      copyDependencies(root, path.join(root, 'out'), ['a']),
      /unreviewed symlink/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
