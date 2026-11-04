interface PreventableEvent {
  preventDefault(): void;
}

interface CloseWindow {
  isDestroyed(): boolean;
  close(): void;
  on(event: 'close', listener: (event: PreventableEvent) => void): unknown;
  on(event: 'closed', listener: () => void): unknown;
  off(event: 'close', listener: (event: PreventableEvent) => void): unknown;
  off(event: 'closed', listener: () => void): unknown;
  webContents: {
    on(event: 'will-prevent-unload', listener: (event: PreventableEvent) => void): unknown;
    off(event: 'will-prevent-unload', listener: (event: PreventableEvent) => void): unknown;
  };
}

/** Adapts Electron's synchronous veto to the controller's asynchronous close attempt. */
export class DesktopCloseGuard {
  private allowClose = false;
  private readonly contents: CloseWindow['webContents'];
  private attempt:
    | {
        promise: Promise<boolean>;
        resolve(value: boolean): void;
        reject(error: unknown): void;
      }
    | undefined;

  constructor(
    private readonly window: CloseWindow,
    private readonly requestClose: () => void,
    private readonly confirmDiscard: () => boolean,
  ) {
    // Retain the EventEmitter: BrowserWindow.webContents cannot be read after destruction.
    this.contents = window.webContents;
    window.on('close', this.onClose);
    window.on('closed', this.onClosed);
    this.contents.on('will-prevent-unload', this.onPreventUnload);
  }

  close(): Promise<boolean> {
    if (this.window.isDestroyed()) return Promise.resolve(true);
    if (this.attempt) return this.attempt.promise;
    let resolve!: (value: boolean) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<boolean>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    this.attempt = { promise, resolve, reject };
    this.allowClose = true;
    try {
      // Never destroy(): close() lets the real renderer run beforeunload first.
      this.window.close();
    } catch (error) {
      this.attempt = undefined;
      reject(error);
    } finally {
      this.allowClose = false;
    }
    return promise;
  }

  dispose() {
    this.window.off('close', this.onClose);
    this.window.off('closed', this.onClosed);
    this.contents.off('will-prevent-unload', this.onPreventUnload);
    this.settle(false);
  }

  private onClose = (event: PreventableEvent) => {
    if (this.allowClose) {
      this.allowClose = false;
      return;
    }
    event.preventDefault();
    this.requestClose();
  };

  private onClosed = () => this.settle(true);

  private onPreventUnload = (event: PreventableEvent) => {
    const attempt = this.attempt;
    if (!attempt) return;
    try {
      // Electron requires a synchronous answer here. preventDefault OVERRIDES the
      // renderer veto, so it must only run after an explicit discard confirmation.
      const discard = this.confirmDiscard();
      if (this.attempt !== attempt) return;
      if (discard) event.preventDefault();
      else this.settle(false);
    } catch (error) {
      attempt.reject(error);
      if (this.attempt === attempt) this.attempt = undefined;
    }
  };

  private settle(allowed: boolean) {
    this.attempt?.resolve(allowed);
    this.attempt = undefined;
  }
}
