import { assert, type Event } from '@praxis/contracts';
import {
  DiagnosticLog,
  exportDiagnostics,
  projectDiagnosticEvent,
  type DiagnosticInput,
} from '@praxis/diagnostics';
import type { SessionStore } from '@praxis/storage-local';
import path from 'node:path';

/** This scope is owned by the authenticated profile and closes before its writer lease. */
export class HostDiagnostics {
  private log: DiagnosticLog | undefined;
  private errorCode: string | null = null;
  private scope = new AbortController();
  private detach: (() => void) | undefined;
  private closing: Promise<void> | undefined;
  private constructor(
    private directory: string,
    private stop: () => void,
  ) {}
  static async open(directory: string, store: SessionStore, stop: () => void) {
    const diagnostics = new HostDiagnostics(path.join(directory, 'diagnostics'), stop);
    try {
      diagnostics.log = await DiagnosticLog.open(diagnostics.directory, {
        onFailure: diagnostics.failure,
      });
    } catch (error) {
      diagnostics.failure(
        (error as NodeJS.ErrnoException).code === 'ENOSPC'
          ? 'DISK_FULL'
          : 'DIAGNOSTICS_WRITE_FAILED',
      );
    }
    const receive = (event: Event) => {
      const value = projectDiagnosticEvent(event);
      if (value) diagnostics.record(value);
    };
    store.on('event', receive);
    diagnostics.detach = () => store.off('event', receive);
    diagnostics.record({ component: 'host', kind: 'lifecycle', phase: 'started' });
    return diagnostics;
  }
  get status() {
    return this.log?.status ?? { available: false, errorCode: this.errorCode };
  }
  record(value: DiagnosticInput) {
    this.log?.record(value);
  }
  async export() {
    assert(!this.scope.signal.aborted, 'DIAGNOSTICS_CLOSED', '诊断范围已关闭。');
    await this.log?.flush();
    return {
      ...(await exportDiagnostics(this.directory, this.scope.signal)),
      status: this.status,
      runtime: { platform: process.platform, arch: process.arch, node: process.version },
    };
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.scope.abort();
    this.detach?.();
    this.record({ component: 'host', kind: 'lifecycle', phase: 'finished' });
    return (this.closing = this.log?.close() ?? Promise.resolve());
  }
  private failure = (code: 'DISK_FULL' | 'DIAGNOSTICS_WRITE_FAILED') => {
    this.errorCode = code;
    process.stderr.write(`${code}: diagnostic logging unavailable\n`);
    if (code === 'DISK_FULL') this.stop();
  };
}
