import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';

export const PUBLIC_BASE = 'https://cdn.doublefloat.cn';
export const UPLOAD_PREFIX = 'folio-nest/praxis/';

interface PicGoInstance {
  Request: { request: (options: Record<string, unknown>) => Promise<unknown> };
  upload: (files: string[]) => Promise<unknown>;
}

const configSchema = z.object({
  picBed: z.object({
    qiniu: z.object({
      accessKey: z.string().min(1),
      secretKey: z.string().min(1),
      bucket: z.literal('doublefloat'),
      url: z.enum([PUBLIC_BASE, `${PUBLIC_BASE}/`]),
      area: z.enum(['', 'z0', 'z1', 'z2', 'na0', 'as0']).optional(),
    }),
  }),
});

async function loadPicGo() {
  const { stdout } = await promisify(execFile)('npm', ['root', '-g'], { timeout: 10_000 });
  const packagePath = path.join(stdout.trim(), 'picgo');
  const loaded: unknown = createRequire(import.meta.url)(packagePath);
  const constructor = z.custom<new (file: string) => PicGoInstance>(
    (value) => typeof value === 'function',
  );
  return z.object({ PicGo: constructor }).parse(loaded).PicGo;
}

/** Wrap only this SDK instance; Qiniu's built-in uploader still creates its own token/body. */
export function requireHttps(picgo: PicGoInstance, area: string, signal: AbortSignal) {
  const original = picgo.Request.request.bind(picgo.Request);
  const host = `upload${area && area !== 'z0' ? `-${area}` : ''}.qiniup.com`;
  picgo.Request.request = async (options) => {
    if (typeof options.url !== 'string') throw new Error('Missing upload URL');
    const url = new URL(options.url);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.hostname !== host ||
      url.username ||
      url.password ||
      url.port ||
      !url.pathname.startsWith('/putb64/')
    ) {
      throw new Error('Unexpected PicGo upload destination');
    }
    url.protocol = 'https:';
    return original({ ...options, url: url.href, maxRedirects: 0, timeout: 60_000, signal });
  };
}

export async function withPicGo<T>(
  signal: AbortSignal,
  run: (picgo: PicGoInstance, directory: string) => Promise<T>,
): Promise<T> {
  const source: unknown = JSON.parse(
    await readFile(path.join(homedir(), '.picgo/config.json'), 'utf8'),
  );
  const qiniu = configSchema.parse(source).picBed.qiniu;
  const PicGo = await loadPicGo();
  const directory = await mkdtemp(path.join(tmpdir(), 'praxis-picgo-'));
  try {
    await chmod(directory, 0o700);
    const configPath = path.join(directory, 'config.json');
    // Copy only the selected credentials/settings, excluding global plugins, proxies and hooks.
    // PicGo writes profile migrations in its constructor, so it must receive this private copy.
    await writeFile(
      configPath,
      JSON.stringify({
        silent: true,
        picgoPlugins: {},
        picBed: {
          current: 'qiniu',
          uploader: 'qiniu',
          qiniu: { ...qiniu, url: PUBLIC_BASE, path: UPLOAD_PREFIX, options: '' },
        },
      }),
      { mode: 0o600 },
    );
    const picgo = new PicGo(configPath);
    await chmod(configPath, 0o600);
    requireHttps(picgo, qiniu.area ?? 'z0', signal);
    return await run(picgo, directory);
  } finally {
    // PicGo's asynchronous initialization can finish a log write during removal.
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
