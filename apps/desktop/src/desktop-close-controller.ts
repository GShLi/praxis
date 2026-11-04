import type { DesktopCloseActivity } from './desktop-close-inspection.ts';

interface DesktopCloseBoundary {
  ready(): Promise<void>;
  inspect(): Promise<DesktopCloseActivity>;
  confirm(activity: DesktopCloseActivity): Promise<boolean>;
  /** Resolves true only after the renderer has allowed unload and the window closed. */
  closeWindow(): Promise<boolean>;
  stopHost(): Promise<void>;
  finish(exitCode: 0 | 1): void;
  reportError(error: unknown): void;
}

type CloseResult = 'closed' | 'cancelled' | 'failed';

/** One instance owns all quit attempts, including repeated OS/menu/window requests. */
export class DesktopCloseController {
  private attempt: Promise<CloseResult> | undefined;

  constructor(
    private readonly boundary: DesktopCloseBoundary,
    // Give startHost.close() time to reap its child after its own five-second deadline.
    private readonly shutdownTimeoutMs = 6000,
  ) {}

  get pending() {
    return this.attempt !== undefined;
  }

  request(): Promise<CloseResult> {
    if (this.attempt) return this.attempt;
    // Publish the attempt before any boundary can synchronously reenter request().
    const attempt = Promise.resolve()
      .then(() => this.close())
      .then((result) => {
        if (result === 'cancelled') this.attempt = undefined;
        return result;
      });
    this.attempt = attempt;
    return attempt;
  }

  private async close(): Promise<CloseResult> {
    try {
      await this.boundary.ready();
      const activity = await this.boundary.inspect();
      if (activity.kind === 'unknown' || activity.activeCount > 0) {
        if (!(await this.boundary.confirm(activity))) return 'cancelled';
      }
      if (!(await this.boundary.closeWindow())) return 'cancelled';
    } catch (error) {
      this.boundary.reportError(error);
      return 'cancelled';
    }
    return this.shutdown();
  }

  private async shutdown(): Promise<CloseResult> {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let exitCode: 0 | 1 = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        deadline = setTimeout(
          () => reject(new Error('Desktop Host shutdown timed out')),
          this.shutdownTimeoutMs,
        );
        Promise.resolve()
          .then(() => this.boundary.stopHost())
          .then(resolve, reject);
      });
    } catch (error) {
      exitCode = 1;
      this.boundary.reportError(error);
    } finally {
      clearTimeout(deadline);
      // Even an error reporter failure must not leave a windowless app running.
      this.boundary.finish(exitCode);
    }
    return exitCode === 0 ? 'closed' : 'failed';
  }
}
