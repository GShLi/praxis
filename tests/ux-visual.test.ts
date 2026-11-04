import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import electron from 'electron';

async function bundleFixture(directory: string) {
  await build({
    entryPoints: ['tests/ux-visual-fixture.tsx'],
    plugins: [
      {
        name: 'private-fixture-imports',
        setup(builder) {
          builder.onLoad({ filter: /ux-visual-.*\.tsx$/ }, async ({ path: filename }) => ({
            // Resolve the same private file URLs as Node tests before bundling for Chromium.
            contents: (await readFile(filename, 'utf8')).replace(
              /import\(\s*new URL\('([^']+)', import\.meta\.url\)\.href\s*\)/g,
              'import("$1")',
            ),
            loader: 'tsx',
          }));
        },
      },
    ],
    outfile: path.join(directory, 'fixture.js'),
    bundle: true,
    format: 'iife',
    globalName: 'uxTests',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
}

// Opt in on a machine with a display; uses the existing Electron dependency.
test(
  'login and shared readability in a real browser',
  {
    skip: process.env.PRAXIS_UI_BROWSER_TESTS !== '1',
    timeout: 60_000,
  },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'praxis-ux-'));
    try {
      await bundleFixture(directory);
      await writeFile(
        path.join(directory, 'index.html'),
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>',
      );
      await writeFile(
        path.join(directory, 'runner.cjs'),
        `
      const { app, BrowserWindow } = require('electron');
      app.commandLine.appendSwitch('force-prefers-reduced-motion');
      app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
      app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 980, height: 900,
        webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true } });
      try {
        await window.loadFile(${JSON.stringify(path.join(directory, 'index.html'))});
        window.webContents.debugger.attach('1.3');
        await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
        const failures = [];
        for (const width of [980, 360]) {
          window.setSize(width, 900);
          failures.push(...await window.webContents.executeJavaScript('uxTests.run()'));
        }
        await window.webContents.executeJavaScript('uxTests.dropdownPreview()');
        if (process.env.PRAXIS_UI_CAPTURE_DIRECTORY) {
          const fs = require('node:fs/promises');
          const path = require('node:path');
          await fs.mkdir(process.env.PRAXIS_UI_CAPTURE_DIRECTORY, { recursive: true });
          for (const theme of ['light', 'dark']) {
            await window.webContents.executeJavaScript('document.documentElement.dataset.theme = ' + JSON.stringify(theme));
            await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
            await fs.writeFile(path.join(process.env.PRAXIS_UI_CAPTURE_DIRECTORY, 'dropdown-' + theme + '.png'), (await window.webContents.capturePage()).toPNG());
          }
        }
        for (const type of ['mousePressed', 'mouseReleased']) {
          await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: 2, y: 2, button: 'left', clickCount: 1 });
        }
        if (await window.webContents.executeJavaScript("Boolean(document.querySelector(':popover-open'))")) failures.push('outside click did not dismiss dropdown');
        console.log(JSON.stringify({ failures }));
        app.exit(0);
      } catch (error) { console.error(error); app.exit(1); }
      });
    `,
      );
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const result = await promisify(execFile)(
        String(electron),
        [path.join(directory, 'runner.cjs')],
        {
          env,
          timeout: 45_000,
          maxBuffer: 1024 * 1024,
        },
      );
      assert.match(result.stdout, /"failures":\[\]/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
