import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { PUBLIC_BASE, UPLOAD_PREFIX, withPicGo } from './picgo-upload.ts';
import { readUploadPng, verifyPublicPng } from './upload-png.ts';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args[0] === '--dry-run';
  const files = dryRun ? args.slice(1) : args;
  if (!files.length || files.some((file) => file.startsWith('-'))) {
    throw new Error('Usage: upload-images.ts [--dry-run] image.png [...]');
  }
  const images = await Promise.all(files.map(readUploadPng));
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const urls = await withPicGo(controller.signal, async (picgo, directory) => {
      if (dryRun) return [];
      const paths: string[] = [];
      for (const image of images) {
        const file = path.join(directory, image.name);
        await writeFile(file, image.bytes, { mode: 0o600 });
        paths.push(file);
      }
      controller.signal.throwIfAborted();
      const results = z.array(z.object({ imgUrl: z.string() })).parse(await picgo.upload(paths));
      if (results.length !== images.length) throw new Error('Incomplete PicGo upload');
      const verified: string[] = [];
      for (const [index, image] of images.entries()) {
        const expectedUrl = `${PUBLIC_BASE}/${UPLOAD_PREFIX}${image.name}`;
        if (results[index]?.imgUrl !== expectedUrl) throw new Error('Unexpected public URL');
        await verifyPublicPng(expectedUrl, image.bytes, controller.signal);
        verified.push(expectedUrl);
      }
      return verified;
    });
    if (dryRun)
      console.log(
        `Validated ${images.length} PNG(s) and isolated PicGo setup; no upload performed.`,
      );
    else console.log(urls.join('\n'));
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

await main().catch(() => {
  // SDK errors can contain authorization headers, tokens or response bodies.
  console.error(
    'PNG validation, PicGo setup, upload or public-byte verification failed. No URLs emitted.',
  );
  process.exitCode = 1;
});
