import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

const MAX_PNG_BYTES = 20 * 1024 * 1024;

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function validatePng(bytes: Buffer): void {
  if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    throw new Error('Invalid PNG signature');
  }
  const compressed: Buffer[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    const end = offset + 12 + size;
    if (end > bytes.length) throw new Error('Truncated PNG');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, end - 4);
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) {
      throw new Error('Invalid PNG checksum');
    }
    if (offset === 8) {
      if (type !== 'IHDR' || size !== 13 || !data.readUInt32BE(0) || !data.readUInt32BE(4)) {
        throw new Error('Invalid PNG dimensions');
      }
    } else if (type === 'IHDR') {
      throw new Error('Duplicate PNG header');
    }
    if (type === 'IDAT') compressed.push(data);
    if (type === 'IEND') {
      if (size || end !== bytes.length || !compressed.length) throw new Error('Invalid PNG end');
      const pixels = inflateSync(Buffer.concat(compressed), { maxOutputLength: 100 * 1024 * 1024 });
      if (!pixels.length) throw new Error('Empty PNG data');
      return;
    }
    offset = end;
  }
  throw new Error('Missing PNG end');
}

export async function readUploadPng(file: string) {
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_PNG_BYTES) throw new Error('Invalid PNG file size');
    const bytes = await handle.readFile();
    if (bytes.length > MAX_PNG_BYTES) throw new Error('PNG grew during read');
    validatePng(bytes);
    const name = `${createHash('sha256').update(bytes).digest('hex')}.png`;
    return { bytes, name };
  } finally {
    await handle.close();
  }
}

export async function verifyPublicPng(url: string, expected: Buffer, signal: AbortSignal) {
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  });
  if (!response.ok || !response.body) throw new Error('Public image unavailable');
  const reader = response.body.getReader();
  let offset = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      if (!chunk.equals(expected.subarray(offset, offset + chunk.length))) {
        throw new Error('Public image differs from local PNG');
      }
      offset += chunk.length;
    }
    if (offset !== expected.length) throw new Error('Public image is incomplete');
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
