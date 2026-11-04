import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import electron from 'electron';

/** Render real components with isolated fictional data; never load a user's profile. */
async function main() {
  const output = path.resolve('out/portfolio');
  const directory = await mkdtemp(path.join(tmpdir(), 'praxis-showcase-'));
  try {
    await mkdir(output, { recursive: true });
    await build({
      entryPoints: ['tests/fixtures/showcase/entry.tsx'],
      outfile: path.join(directory, 'app.js'),
      bundle: true,
      format: 'iife',
      platform: 'browser',
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    await copyFile(
      'apps/web/public/praxis-icon-192.png',
      path.join(directory, 'praxis-icon-192.png'),
    );
    await writeFile(
      path.join(directory, 'index.html'),
      '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Praxis · 演示数据</title><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>',
    );
    await build({
      entryPoints: ['scripts/portfolio/capture-runner.ts'],
      outfile: path.join(directory, 'runner.cjs'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
    });
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = await promisify(execFile)(
      String(electron),
      [path.join(directory, 'runner.cjs'), directory, output],
      { env, timeout: 120_000, maxBuffer: 1024 * 1024 },
    );
    console.log(result.stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await main();
