import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import electron from 'electron';

async function bundle(directory: string) {
  await build({
    entryPoints: ['tests/ui-controller-fixture.tsx'],
    outfile: join(directory, 'fixture.js'),
    bundle: true,
    format: 'esm',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [
      {
        name: 'private-hook-fixture',
        setup(builder) {
          builder.onLoad({ filter: /ui-controller-fixture\.tsx$/ }, async ({ path }) => ({
            contents: (await readFile(path, 'utf8')).replace(
              /import\(\s*new URL\('([^']+)', import\.meta\.url\)\.href\s*\)/g,
              'import("$1")',
            ),
            loader: 'tsx',
          }));
        },
      },
    ],
  });
  await writeFile(
    join(directory, 'index.html'),
    '<!doctype html><div id="root"></div><script type="module">import { run } from "./fixture.js"; window.result = run();</script>',
  );
  await writeFile(
    join(directory, 'runner.cjs'),
    `
    const { app, BrowserWindow } = require('electron');
    app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))});
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false,
        webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true } });
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});
        console.log(JSON.stringify({ failures: await window.webContents.executeJavaScript('window.result') }));
        app.exit(0);
      } catch (error) { console.error(error); app.exit(1); }
    });`,
  );
}

test(
  'UI controller preserves draft receipts, mode selection, subscription ordering and identity invalidation',
  {
    skip: process.env.PRAXIS_UI_BROWSER_TESTS !== '1',
    timeout: 60_000,
  },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'praxis-controller-'));
    try {
      await bundle(directory);
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const output = await promisify(execFile)(String(electron), [join(directory, 'runner.cjs')], {
        env,
        timeout: 45_000,
        maxBuffer: 1024 * 1024,
      });
      assert.match(output.stdout, /"failures":\[\]/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
