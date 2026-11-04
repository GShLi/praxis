import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from './release/process.ts';

const branding = path.resolve('assets/branding');
const source = path.join(branding, 'praxis-icon-source.png');

async function resize(size: number, target: string) {
  await run('sips', ['-z', String(size), String(size), source, '--out', target]);
}

async function writeWindowsIcon(directory: string) {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images: Buffer[] = [];
  for (const size of sizes) {
    const file = path.join(directory, `windows-${size}.png`);
    await resize(size, file);
    images.push(await readFile(file));
  }
  // Windows Vista+ ICO supports PNG payloads; preserve alpha at every launcher size.
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  for (const [index, image] of images.entries()) {
    const size = sizes[index]!;
    const entry = 6 + index * 16;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  }
  await writeFile(path.join(branding, 'praxis.ico'), Buffer.concat([header, ...images]));
}

async function main() {
  if (process.platform !== 'darwin')
    throw new Error(
      'Icon regeneration requires macOS sips/iconutil; committed icons build on all OSes.',
    );
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'praxis-icons-'));
  try {
    const iconset = path.join(temporary, 'Praxis.iconset');
    await mkdir(iconset);
    for (const size of [16, 32, 128, 256, 512]) {
      await resize(size, path.join(iconset, `icon_${size}x${size}.png`));
      await resize(size * 2, path.join(iconset, `icon_${size}x${size}@2x.png`));
    }
    await run('iconutil', ['-c', 'icns', iconset, '-o', path.join(branding, 'praxis.icns')]);
    await resize(1024, path.join(branding, 'praxis-icon.png'));
    await writeWindowsIcon(temporary);
    const web = path.resolve('apps/web/public');
    await mkdir(web, { recursive: true });
    await resize(32, path.join(web, 'favicon-32.png'));
    await resize(192, path.join(web, 'praxis-icon-192.png'));
    await resize(512, path.join(web, 'praxis-icon-512.png'));
    console.log('Generated macOS, Windows, Linux and Web icons from the shared master.');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

await main();
