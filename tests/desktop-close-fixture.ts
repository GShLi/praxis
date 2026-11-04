import type { EventEmitter } from 'node:events';

// App-internal modules have no production package exports. Match the root tests'
// file-URL loading convention, with only the boundary contracts this suite consumes.
export type DesktopCloseActivity = { kind: 'known'; activeCount: number } | { kind: 'unknown' };
type CloseResult = 'closed' | 'cancelled' | 'failed';
interface CloseController {
  readonly pending: boolean;
  request(): Promise<CloseResult>;
}
interface CloseBoundary {
  ready(): Promise<void>;
  inspect(): Promise<DesktopCloseActivity>;
  confirm(activity: DesktopCloseActivity): Promise<boolean>;
  closeWindow(): Promise<boolean>;
  stopHost(): Promise<void>;
  finish(exitCode: 0 | 1): void;
  reportError(error: unknown): void;
}
interface WindowBoundary extends Pick<EventEmitter, 'on' | 'off'> {
  isDestroyed(): boolean;
  close(): void;
  webContents: Pick<EventEmitter, 'on' | 'off'>;
}
interface SessionReader {
  request(method: string, params: unknown, timeoutMs: number): Promise<unknown>;
}

export const { DesktopCloseController } = (await import(
  new URL('../apps/desktop/src/desktop-close-controller.ts', import.meta.url).href
)) as {
  DesktopCloseController: new (
    boundary: CloseBoundary,
    shutdownTimeoutMs?: number,
  ) => CloseController;
};

export const { DesktopCloseGuard } = (await import(
  new URL('../apps/desktop/src/desktop-close-guard.ts', import.meta.url).href
)) as {
  DesktopCloseGuard: new (
    window: WindowBoundary,
    requestClose: () => void,
    confirmDiscard: () => boolean,
  ) => { close(): Promise<boolean>; dispose(): void };
};

export const { inspectDesktopCloseActivity } = (await import(
  new URL('../apps/desktop/src/desktop-close-inspection.ts', import.meta.url).href
)) as {
  inspectDesktopCloseActivity(rpc: SessionReader | undefined): Promise<DesktopCloseActivity>;
};
