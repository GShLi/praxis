import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import electron from 'electron';

test(
  'task presentation interactions run only from explicit user clicks in a narrow browser',
  {
    skip: process.env.PRAXIS_UI_BROWSER_TESTS !== '1',
    timeout: 60_000,
  },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'praxis-task-browser-'));
    try {
      await build({
        entryPoints: ['tests/task-presentation-browser-fixture.tsx'],
        outfile: join(directory, 'fixture.js'),
        bundle: true,
        format: 'esm',
        define: { 'process.env.NODE_ENV': '"production"' },
      });
      await writeFile(
        join(directory, 'index.html'),
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="theme.css"><link rel="stylesheet" href="elements.css"><link rel="stylesheet" href="fixture.css"></head><body><script type="module">import { run } from "./fixture.js"; window.taskTest = run();</script></body></html>',
      );
      await writeFile(join(directory, 'runner.cjs'), runner(directory));
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

function runner(directory: string) {
  return `const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))});
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 390, height: 844,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true } });
  try {
    await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});
    const failures = await window.webContents.executeJavaScript('window.taskTest');
    console.log(JSON.stringify({ failures }));
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});`;
}
