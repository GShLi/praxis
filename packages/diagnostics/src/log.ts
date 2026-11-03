import { randomUUID } from 'node:crypto';
import { prepareDirectory } from './files.ts';
import { diagnosticInputSchema, retentionSchema, type DiagnosticRetention } from './schema.ts';
import { DiagnosticWriter } from './writer.ts';

type Failure = 'DIAGNOSTICS_WRITE_FAILED' | 'DISK_FULL';
interface Options extends Partial<DiagnosticRetention> {
  onFailure?: (code: Failure) => void;
}
export class DiagnosticLog {
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private dropped = 0;
  private invalid = 0;
  private failure: Failure | undefined;
  private closing: Promise<void> | undefined;
  private constructor(
    private writer: DiagnosticWriter,
    private retention: DiagnosticRetention,
    private onFailure?: (code: Failure) => void,
  ) {}
  static async open(directory: string, options: Options = {}) {
    const { onFailure, ...raw } = options;
    const retention = retentionSchema.parse(raw);
    const writer = new DiagnosticWriter(await prepareDirectory(directory), retention);
    await writer.prune();
    return new DiagnosticLog(writer, retention, onFailure);
  }
  get status() {
    return {
      available: !this.failure && !this.closing,
      closed: Boolean(this.closing),
      pending: this.pending,
      droppedRecords: this.dropped,
      invalidRecords: this.invalid,
      errorCode: this.failure ?? null,
      retention: { ...this.retention },
    };
  }
  record(raw: unknown): boolean {
    if (this.closing || this.failure || this.pending >= this.retention.queueLimit) {
      this.dropped++;
      return false;
    }
    const parsed = diagnosticInputSchema.safeParse(raw);
    if (!parsed.success) {
      this.invalid++;
      return false;
    }
    const line =
      JSON.stringify({
        ...parsed.data,
        version: 1,
        id: randomUUID(),
        timestamp: new Date().toISOString(),
      }) + '\n';
    this.pending++;
    this.queue = this.queue
      .then(async () => {
        if (this.failure) {
          this.dropped++;
          return;
        }
        await this.writer.write(line);
      })
      .catch((error: unknown) => this.fail(error))
      .finally(() => {
        this.pending--;
      });
    return true;
  }
  flush() {
    return this.queue;
  }
  close(): Promise<void> {
    return (this.closing ??= this.queue
      .then(() => this.writer.close())
      .catch((error: unknown) => this.fail(error)));
  }
  private fail(error: unknown) {
    if (this.failure) return;
    this.failure =
      (error as NodeJS.ErrnoException)?.code === 'ENOSPC'
        ? 'DISK_FULL'
        : 'DIAGNOSTICS_WRITE_FAILED';
    try {
      this.onFailure?.(this.failure);
    } catch {
      /* A diagnostic observer cannot interrupt resource cleanup or expose the original error. */
    }
  }
}
