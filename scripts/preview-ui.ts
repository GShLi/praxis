import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
await mkdir('.cache/ui-preview', { recursive: true });
await build({
  entryPoints: ['tests/fixtures/ui-preview.tsx'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  outfile: '.cache/ui-preview/app.js',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const script = (await readFile('.cache/ui-preview/app.js', 'utf8')).replaceAll(
  '</script',
  '<\\/script',
);
const style = await readFile('.cache/ui-preview/app.css', 'utf8');
await writeFile(
  '.cache/ui-preview/index.html',
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Praxis 开发样例 · 无模型调用</title><style>${style}</style></head><body><div id="root"></div><script>${script}</script></body></html>`,
);
console.log('Local UI fixture: .cache/ui-preview/index.html');
