import { assert } from '@praxis/contracts';
import { randomUUID } from 'node:crypto';
import { open, unlink, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { logFiles } from './files.ts';
import type { DiagnosticRetention } from './schema.ts';

/** Only the owning logger's serialized queue calls this writer. The profile/server lease excludes other writers. */
export class DiagnosticWriter {
  private handle: FileHandle | undefined;
  private current: string | undefined;
  private createdAt = 0;
  private bytes = 0;
  private pruneAfter = 0;
  constructor(
    readonly directory: string,
    private retention: DiagnosticRetention,
  ) {}
  async write(line: string) {
    const size = Buffer.byteLength(line);
    assert(size <= this.retention.maxFileBytes, 'DIAGNOSTICS_LIMIT', '诊断记录超过单文件限额。');
    if (
      !this.handle ||
      this.bytes + size > this.retention.maxFileBytes ||
      Date.now() - this.createdAt >= this.retention.maxAgeMs
    )
      await this.rotate();
    if (Date.now() >= this.pruneAfter) await this.prune();
    const handle = this.handle;
    assert(handle, 'DIAGNOSTICS_UNAVAILABLE', '诊断写入器未打开。');
    assert((await handle.stat()).nlink === 1, 'DIAGNOSTICS_PATH', '诊断文件出现了硬链接。');
    await handle.writeFile(line);
    this.bytes += size;
  }
  private async rotate() {
    await this.close();
    this.createdAt = Math.max(Date.now(), this.createdAt + 1);
    this.current = `diagnostics-${this.createdAt}-${randomUUID()}.jsonl`;
    this.handle = await open(path.join(this.directory, this.current), 'ax', 0o600);
    this.bytes = 0;
    await this.prune();
  }
  async prune() {
    const others = (await logFiles(this.directory)).filter((item) => item.name !== this.current);
    let retained = this.current ? 1 : 0;
    this.pruneAfter = this.current ? this.createdAt + this.retention.maxAgeMs : Infinity;
    for (const item of others) {
      if (
        Date.now() - item.createdAt >= this.retention.maxAgeMs ||
        retained >= this.retention.maxFiles
      )
        await unlink(item.file);
      else {
        retained++;
        this.pruneAfter = Math.min(this.pruneAfter, item.createdAt + this.retention.maxAgeMs);
      }
    }
  }
  async close() {
    const handle = this.handle;
    this.handle = undefined;
    if (handle) {
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
  }
}
