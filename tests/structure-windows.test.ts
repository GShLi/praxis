import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspect } from '../scripts/structure/source.ts';
import { dependencies, cycles } from '../scripts/structure/dependencies.ts';
import { files, owner, packages, sourceFiles } from '../scripts/structure/project.ts';

const windows = (file: string) => file.replaceAll('/', '\\');

test('Windows source paths produce the same exception keys and entry-point checks', () => {
  const file = 'packages/ui/src/app/useAppController.ts';
  const source = readFileSync(file, 'utf8');
  const result = inspect(windows(file), source);
  assert.deepEqual(result, inspect(file, source));
  const reviews = JSON.parse(readFileSync('docs/structure-exceptions.json', 'utf8'));
  assert(result.sizes.length > 0);
  for (const finding of result.sizes) assert(reviews[finding.key]?.maxLines >= finding.lines);
  const entry = '// entry\n'.repeat(101) + 'export function work() {}';
  const entryResult = inspect('packages\\example\\src\\index.ts', entry);
  assert.equal(entryResult.sizes[0]?.limit, 100);
  assert.equal(entryResult.sizes[0]?.key, 'packages/example/src/index.ts');
  assert(entryResult.errors.some((error) => error.includes('index.ts 只能导出')));
});

test('Windows discovery paths stay readable and package ownership accepts either separator', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'praxis-structure-'));
  try {
    mkdirSync(path.join(directory, 'src'));
    writeFileSync(path.join(directory, 'src', 'example.ts'), 'export const value = 1;');
    const discovered = files(windows(directory));
    assert.equal(discovered.length, 1);
    assert(!discovered[0]!.includes('\\'));
    assert.equal(readFileSync(discovered[0]!, 'utf8'), 'export const value = 1;');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  const workspace = packages().map((item) => ({ ...item, directory: windows(item.directory) }));
  const ui = workspace.find((item) => item.manifest.name === '@praxis/ui');
  assert(ui);
  assert.equal(owner('packages/ui/src/App.tsx', workspace), ui);
  assert.equal(owner('packages\\ui\\src\\App.tsx', workspace), ui);
  assert.equal(owner('packages\\ui-other\\src\\App.tsx', workspace), workspace[0]);
  assert(sourceFiles().every((file) => !file.includes('\\')));
  assert(packages().every((item) => !item.directory.includes('\\')));
});

test('Windows dependency resolution keeps filesystem checks and graph edges consistent', () => {
  const workspace = packages();
  const file = 'packages/ui/src/app/useIdentity.ts';
  const imports = [
    { name: './identity-refresh.ts', typeOnly: false },
    { name: '@praxis/model-core/provider-models', typeOnly: true },
  ];
  const expectedErrors: string[] = [],
    actualErrors: string[] = [];
  const expected = dependencies(file, imports, workspace, expectedErrors);
  const actual = dependencies(
    windows(file),
    imports,
    workspace.map((item) => ({ ...item, directory: windows(item.directory) })),
    actualErrors,
  );
  assert.deepEqual(actualErrors, []);
  assert.deepEqual(expectedErrors, []);
  assert.deepEqual(actual, expected);
  assert.equal(actual.runtime.length, 1);
  for (const edge of actual.edges) {
    assert(!edge.includes('\\'));
    assert(readFileSync(edge, 'utf8').length > 0);
  }
});

test('Windows paths cannot bypass package, reverse-entry or browser Node boundaries', () => {
  const errors: string[] = [];
  dependencies(
    'packages\\ui\\src\\app\\useIdentity.ts',
    [
      { name: '..\\index.ts', typeOnly: true },
      { name: '../../../model-core/src/provider-models.ts', typeOnly: true },
      { name: 'node:fs', typeOnly: false },
    ],
    packages(),
    errors,
  );
  assert(errors.some((error) => error.includes('内部反向导入入口')));
  assert(errors.some((error) => error.includes('跨包相对导入')));
  assert(errors.some((error) => error.includes('浏览器源码依赖 Node')));
  const webErrors: string[] = [];
  dependencies(
    'apps\\web\\src\\main.ts',
    [{ name: 'node:fs', typeOnly: false }],
    packages(),
    webErrors,
  );
  assert(webErrors.some((error) => error.includes('浏览器源码依赖 Node')));
});

test('cycles match mixed Windows/POSIX graph nodes and merge separator aliases', () => {
  const errors: string[] = [];
  cycles(
    new Map([
      ['packages\\one\\a.ts', ['packages/one/b.ts']],
      ['packages/one/a.ts', []],
      ['packages/one/b.ts', ['packages\\one\\a.ts']],
    ]),
    errors,
  );
  assert.deepEqual(errors, ['依赖环: packages/one/a.ts → packages/one/b.ts → packages/one/a.ts']);
});
