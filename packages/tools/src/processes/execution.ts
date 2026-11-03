import { PraxisError } from '@praxis/contracts';
import { EventEmitter } from 'node:events';
import type { ExecutionJournal } from './journal.ts';
import { ProcessOutput } from './output.ts';
import type { CommandExit, ExecutionRecord, PreparedCommand, RunningCommand } from './types.ts';

/** Owns exactly one prepared backend, its output, cancellation, and terminal commit. */
export class CommandExecution {
  readonly output: ProcessOutput;
  readonly changed = new EventEmitter();
  private resolveFinished!: () => void;
  readonly finished = new Promise<void>((resolve) => {
    this.resolveFinished = resolve;
  });
  private running: RunningCommand | undefined;
  private reason: 'cancelled' | 'timed_out' | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  private stopping: Promise<void> | undefined;
  private controller = new AbortController();
  private failed = false;
  private recordingFailed = false;
  private completing = false;
  private endUnknown!: () => void;
  private unknown = new Promise<void>((resolve) => {
    this.endUnknown = resolve;
  });
  private detach = () => {};
  constructor(
    readonly record: ExecutionRecord,
    private prepared: PreparedCommand,
    private journal: ExecutionJournal,
    private fatal: (error: Error) => void,
  ) {
    this.output = new ProcessOutput(record.executionId);
  }
  get active() {
    return !this.record.finishedAt;
  }
  async start(signal: AbortSignal, timeoutMs: number) {
    const aborted = () => this.requestStop('cancelled');
    signal.addEventListener('abort', aborted, { once: true });
    this.detach = () => signal.removeEventListener('abort', aborted);
    this.timer = setTimeout(() => this.requestStop('timed_out'), timeoutMs);
    if (signal.aborted) aborted();
    try {
      this.running = await this.prepared.start(this.capture.bind(this), this.controller.signal);
      void this.monitor().finally(() => this.resolveFinished());
      try {
        this.journal.started(this.record.executionId);
      } catch {
        this.fail('EXECUTION_RECORD_FAILED', '命令启动回执保存失败，已停止执行。');
      }
      if (this.reason) this.stopBackend();
    } catch (error) {
      await this.complete({ exitCode: null, signal: null, cleanup: 'unknown' });
      this.resolveFinished();
      throw error;
    }
  }
  private capture(stream: 'stdout' | 'stderr', data: Buffer) {
    if (!this.active || this.failed || this.completing) return;
    try {
      this.journal.head(this.record.executionId, this.output.append(stream, data));
      this.changed.emit('change');
    } catch {
      this.fail('EXECUTION_RECORD_FAILED', '命令输出保存失败，已停止执行。');
    }
  }
  requestStop(reason: 'cancelled' | 'timed_out' = 'cancelled') {
    if (!this.active || this.reason || this.completing) return;
    this.reason = reason;
    this.record.processState = 'cancelling';
    this.controller.abort();
    this.cleanupTimer = setTimeout(() => this.endUnknown(), 10_000);
    this.stopBackend();
    this.changed.emit('change');
  }
  private stopBackend() {
    if (!this.running || this.stopping) return;
    this.stopping = Promise.resolve()
      .then(() => this.running!.stop())
      .catch(() => {
        this.fail('EXECUTION_CLEANUP_UNKNOWN', '命令终止失败，无法确认执行域已清理。');
        this.endUnknown();
      });
  }
  private async monitor() {
    let exit: CommandExit;
    try {
      exit = await Promise.race([
        this.running!.done,
        this.unknown.then(
          (): CommandExit => ({ exitCode: null, signal: null, cleanup: 'unknown' }),
        ),
      ]);
    } catch {
      exit = { exitCode: null, signal: null, cleanup: 'unknown' };
    }
    await this.complete(exit);
  }
  private async complete(exit: CommandExit) {
    this.completing = true;
    clearTimeout(this.timer);
    clearTimeout(this.cleanupTimer);
    this.detach();
    try {
      this.journal.head(this.record.executionId, this.output.end());
    } catch {
      this.fail('EXECUTION_RECORD_FAILED', '命令输出保存失败。');
    }
    try {
      await this.prepared.close();
    } catch {
      this.fail('EXECUTION_CLEANUP_UNKNOWN', '命令资源未能确认释放。');
    }
    if (exit.cleanup !== 'complete')
      this.fail('EXECUTION_CLEANUP_UNKNOWN', '无法确认命令子孙进程已全部退出。');
    Object.assign(this.record, {
      exitCode: exit.exitCode,
      signal: exit.signal,
      finishedAt: new Date().toISOString(),
      processState: this.failed
        ? 'unknown'
        : (this.reason ?? (exit.exitCode === 0 ? 'succeeded' : 'failed')),
    });
    try {
      if (!this.recordingFailed) this.journal.finish(this.record, this.output);
    } catch {
      this.fail('EXECUTION_RECORD_FAILED', '命令结束记录保存失败。');
      this.record.processState = 'unknown';
    }
    this.changed.emit('change');
  }
  private fail(code: string, message: string) {
    if (code === 'EXECUTION_RECORD_FAILED') this.recordingFailed = true;
    if (this.failed) return;
    this.failed = true;
    this.requestStop();
    this.fatal(new PraxisError(code, message));
  }
  async wait(ms: number, signal: AbortSignal) {
    signal.throwIfAborted();
    if (!ms || !this.active) return;
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        cleanup();
        resolve();
      };
      const abort = () => {
        cleanup();
        reject(signal.reason);
      };
      const timer = setTimeout(finish, ms);
      const cleanup = () => {
        clearTimeout(timer);
        this.changed.off('change', finish);
        signal.removeEventListener('abort', abort);
      };
      this.changed.once('change', finish);
      signal.addEventListener('abort', abort, { once: true });
    });
  }
}
