import { assert, PraxisError } from '@praxis/contracts';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

/** Owns the bounded response buffer and the single prepare/commit handshake. */
export class FileResponseController {
  failure: unknown;
  output = Buffer.alloc(0);
  private checked: boolean;
  private size = 0;
  private kill: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private child: ChildProcessWithoutNullStreams,
    private signal: AbortSignal,
    private beforeCommit?: () => void,
  ) {
    this.checked = !beforeCommit;
  }
  stop = (reason: unknown) => {
    if (this.failure) return;
    this.failure =
      reason instanceof Error
        ? reason
        : new PraxisError('FILE_NATIVE_FAILED', '文件发布未获确认。');
    this.child.stdin.end();
    this.kill = setTimeout(() => this.child.kill('SIGKILL'), 1000);
  };
  abort = () => this.stop(this.signal.reason);
  consume = (data: Buffer) => {
    if (this.failure) return;
    try {
      this.size += data.length;
      assert(this.size <= 6 * 1024 * 1024, 'FILE_NATIVE_LIMIT', '原生文件响应超限。');
      this.output = Buffer.concat([this.output, data]);
      if (!this.checked && this.output.includes(10)) this.handshake();
    } catch (error) {
      this.stop(error);
    }
  };
  private handshake() {
    this.checked = true;
    const end = this.output.indexOf(10);
    const value: unknown = JSON.parse(this.output.subarray(0, end).toString('utf8'));
    if (value && typeof value === 'object' && 'status' in value && value.status === 'ready') {
      this.output = this.output.subarray(end + 1);
      this.signal.throwIfAborted();
      this.beforeCommit?.();
      this.signal.throwIfAborted();
      this.child.stdin.end('1');
    } else this.child.stdin.end();
  }
  close() {
    clearTimeout(this.kill);
  }
}
