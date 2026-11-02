import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assert } from '../../contracts/src/index.ts';

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(',')}}`;
}
export const fingerprint = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex');

/** Single Host writer, serialized revision checks, atomic publication. Stores no credentials. */
export class ConfigFile<T> {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    readonly file: string,
    private validate: (value: unknown) => T,
    private initial: T,
  ) {}
  async read(): Promise<{ revision: number; value: T }> {
    try {
      const text = await readFile(this.file, 'utf8');
      assert(Buffer.byteLength(text) <= 2 * 1024 * 1024, 'CONFIG_LIMIT', '配置超出大小限制。');
      const record = JSON.parse(text) as { revision: number; value: unknown };
      assert(
        Number.isSafeInteger(record.revision) && record.revision >= 1,
        'CONFIG_INVALID',
        '配置版本无效。',
      );
      return { revision: record.revision, value: this.validate(record.value) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { revision: 0, value: structuredClone(this.initial) };
      throw error;
    }
  }
  update(expectedRevision: number, change: (current: T) => T) {
    const operation = this.pending.then(async () => {
      const current = await this.read();
      assert(
        current.revision === expectedRevision,
        'CONFIG_CONFLICT',
        '配置已修改，请刷新后重试。',
      );
      const result = {
        revision: current.revision + 1,
        value: this.validate(change(current.value)),
      };
      const text = JSON.stringify(result);
      assert(Buffer.byteLength(text) <= 2 * 1024 * 1024, 'CONFIG_LIMIT', '配置超出大小限制。');
      await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, text, { flag: 'wx', mode: 0o600 });
        await rename(temporary, this.file);
      } finally {
        await rm(temporary, { force: true });
      }
      return result;
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
}
