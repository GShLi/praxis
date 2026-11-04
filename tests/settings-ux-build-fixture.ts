import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Build only. The parent task owns all native browser interactions.
const directory = '.cache/settings-ux-preview';
await mkdir(directory, { recursive: true });
await build({
  entryPoints: ['tests/settings-ux-fixture.tsx'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  outfile: `${directory}/app.js`,
  define: { 'process.env.NODE_ENV': '"production"' },
});
const script = (await readFile(`${directory}/app.js`, 'utf8')).replaceAll('</script', '<\\/script');
const style = await readFile(`${directory}/app.css`, 'utf8');
await writeFile(
  `${directory}/index.html`,
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>设置体验样例 · 不连接真实服务</title><style>${style}</style></head><body><div id="root"></div><script>${script}</script></body></html>`,
);
console.log(`${directory}/index.html`);
