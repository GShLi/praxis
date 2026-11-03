import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
const execute = promisify(execFile);

test('owner process exit before native commit closes the pipe and cleans prepared file content', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-file-owner-'));
  try {
    const source = `import {WorkspaceFiles} from '@praxis/tools/files';
      let checks=0;
      const files=await WorkspaceFiles.open(process.argv[1],()=> 'artifact',[],()=>{if(++checks===2)process.exit(0)});
      await files.write({path:'file.txt',mode:'create',content:'fixture'},AbortSignal.timeout(5000));`;
    await execute(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', source, root],
      { timeout: 10000 },
    );
    const deadline = Date.now() + 3000;
    while ((await readdir(root)).length && Date.now() < deadline) await delay(25);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bundled file tools find their fixed native helper and operate without source TypeScript', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-file-bundle-'));
  try {
    const workspace = path.join(root, 'workspace');
    await mkdir(workspace);
    const bundle = path.join(root, 'main.mjs');
    await build({
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      outfile: bundle,
      stdin: {
        resolveDir: process.cwd(),
        loader: 'ts',
        contents: `import {WorkspaceFiles} from '@praxis/tools/files';
        const files=await WorkspaceFiles.open(process.argv[2],()=> 'artifact');
        await files.write({path:'index.html',mode:'create',content:'<h1>Hello World</h1>'},AbortSignal.timeout(5000));
        console.log(JSON.stringify(await files.read({path:'index.html',startLine:1,lineCount:10})));`,
      },
    });
    const result = await execute(process.execPath, [bundle, workspace], {
      timeout: 10000,
      env: { ...process.env, PRAXIS_NATIVE_DIR: path.resolve('build/native') },
    });
    assert.equal(JSON.parse(result.stdout).lines[0].text, '<h1>Hello World</h1>');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
