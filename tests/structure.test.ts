import assert from 'node:assert/strict';
import test from 'node:test';
import { inspect } from '../scripts/structure/source.ts';
import { dependencies, cycles } from '../scripts/structure/dependencies.ts';
import type { Package } from '../scripts/structure/project.ts';

test('structure gate detects fat entry points, private imports and missing dependencies', () => {
  assert.ok(
    inspect('packages/example/src/index.ts', 'export function write() { return 1; }').errors.length,
  );
  assert.equal(
    inspect('packages/example/src/index.ts', "export { write } from './write.ts';").errors.length,
    0,
  );
  const workspace: Package[] = [
    { directory: '.', manifest: { name: 'root' } },
    {
      directory: 'packages/one',
      manifest: { name: '@praxis/one', dependencies: { '@praxis/two': 'workspace:*' } },
    },
    {
      directory: 'packages/two',
      manifest: { name: '@praxis/two', exports: { '.': './src/index.ts' } },
    },
  ];
  const errors: string[] = [];
  dependencies(
    'packages/one/src/worker.ts',
    [
      { name: '../../two/src/private.ts', typeOnly: false },
      { name: '@praxis/two/private', typeOnly: true },
      { name: 'undeclared-lib', typeOnly: false },
    ],
    workspace,
    errors,
  );
  assert.ok(errors.some((text) => text.includes('跨包相对导入')));
  assert.ok(errors.some((text) => text.includes('非公开导出')));
  assert.ok(errors.some((text) => text.includes('未声明依赖')));
});
test('structure gate finds cycles including types without rejecting shared leaves', () => {
  const errors: string[] = [];
  cycles(
    new Map([
      ['a', ['b']],
      ['b', ['c']],
      ['c', ['a']],
    ]),
    errors,
  );
  assert.equal(errors.length, 1);
  const acyclic: string[] = [];
  cycles(
    new Map([
      ['a', ['c']],
      ['b', ['c']],
      ['c', []],
    ]),
    acyclic,
  );
  assert.deepEqual(acyclic, []);
});

test('inline import types still require a declared dependency', () => {
  const result = inspect(
    'tests/example.test.ts',
    `let services: import('@praxis/plugin-sdk').PluginServices;
     type Module = typeof import('@praxis/model-core');`,
  );
  const errors: string[] = [];
  dependencies(
    'tests/example.test.ts',
    result.imports,
    [{ directory: '.', manifest: { name: 'root' } }],
    errors,
  );
  assert(errors.some((error) => error.includes('未声明依赖 @praxis/plugin-sdk')));
  assert(errors.some((error) => error.includes('未声明依赖 @praxis/model-core')));
  assert(result.imports.every((dependency) => dependency.typeOnly));
});
