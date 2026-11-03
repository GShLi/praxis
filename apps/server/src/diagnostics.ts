import type { ChatRuntime } from '@praxis/chat-runtime';
import type { Event } from '@praxis/contracts';
import { DiagnosticLog, projectDiagnosticEvent, type DiagnosticInput } from '@praxis/diagnostics';
import { acquireLease } from '@praxis/workspace';
import path from 'node:path';
import { serverDiagnosticDirectory } from './diagnostics-path.ts';

/** Instance-owned server logs. No user HTTP route exports these multi-user records. */
export class ServerDiagnostics {
  private log: DiagnosticLog | undefined;
  private lease: Awaited<ReturnType<typeof acquireLease>> | undefined;
  private closing: Promise<void> | undefined;
  private constructor(
    private chat: ChatRuntime,
    private stop: () => void,
  ) {}
  static async open(chat: ChatRuntime, origin: string, stop: () => void) {
    const scope = new ServerDiagnostics(chat, stop);
    const directory = serverDiagnosticDirectory(origin);
    try {
      scope.lease = await acquireLease(path.join(directory, 'writer.lock'));
      scope.log = await DiagnosticLog.open(directory, { onFailure: scope.failure });
      scope.lease.onLost(() => {
        scope.stop();
        void scope.close().catch(() => scope.failure('DIAGNOSTICS_WRITE_FAILED'));
      });
    } catch (error) {
      scope.failure(
        (error as NodeJS.ErrnoException).code === 'ENOSPC'
          ? 'DISK_FULL'
          : 'DIAGNOSTICS_WRITE_FAILED',
      );
    }
    if (!scope.closing) {
      chat.on('event', scope.receive);
      chat.on('fatal', scope.fatal);
      scope.record({ component: 'server', kind: 'lifecycle', phase: 'started' });
    }
    return scope;
  }
  record(value: DiagnosticInput) {
    return this.log?.record(value) ?? false;
  }
  private receive = (event: Event) => {
    const value = projectDiagnosticEvent(event);
    if (value) this.record(value);
  };
  private fatal = () => {
    this.record({
      component: 'server',
      kind: 'lifecycle',
      phase: 'error',
      code: 'STORAGE_FAILURE',
    });
    this.stop();
  };
  private failure = (code: 'DISK_FULL' | 'DIAGNOSTICS_WRITE_FAILED') => {
    process.stderr.write(`${code}: diagnostic logging unavailable\n`);
    if (code === 'DISK_FULL') this.stop();
  };
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.chat.off('event', this.receive);
    this.chat.off('fatal', this.fatal);
    this.record({ component: 'server', kind: 'lifecycle', phase: 'finished' });
    return (this.closing = this.release());
  }
  private async release() {
    try {
      await this.log?.close();
    } finally {
      await this.lease?.release();
    }
  }
}
