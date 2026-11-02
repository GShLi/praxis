import { startHost } from '@praxis/client-host';
import { safeError } from '@praxis/contracts';
import { app, dialog, type BrowserWindow } from 'electron';
import path from 'node:path';
import { installBridge } from './bridge.ts';
import { clearSessionHandlers, createWindow } from './window.ts';

export class DesktopApplication {
  private host: Awaited<ReturnType<typeof startHost>> | undefined;
  private window: BrowserWindow | undefined;
  private disposeBridge: (() => void) | undefined;
  private stopping: Promise<void> | undefined;
  private starting: Promise<void> | undefined;
  async run(directory: string) {
    app.on('window-all-closed', this.onWindowClosed);
    app.on('before-quit', this.onBeforeQuit);
    this.starting = this.start(directory);
    try {
      await this.starting;
    } catch (error) {
      const safe = safeError(error);
      dialog.showErrorBox('Praxis 启动失败', `${safe.code}: ${safe.safeMessage}`);
      this.requestStop();
    }
  }
  private async start(directory: string) {
    await app.whenReady();
    if (this.stopping) return;
    this.host = await startHost(
      'desktop',
      {
        PRAXIS_DATA_DIR: app.getPath('userData'),
        PRAXIS_NATIVE_DIR: path.resolve(directory, '../../build/native'),
      },
      path.resolve(directory, '../node/host.mjs'),
    );
    if (this.stopping) return;
    this.window = createWindow(directory);
    this.disposeBridge = installBridge(this.window, this.host);
    await this.window.loadFile(path.resolve(directory, '../web/index.html'));
  }
  private onWindowClosed = () => app.quit();
  private onBeforeQuit = (event: Electron.Event) => {
    event.preventDefault();
    this.requestStop();
  };
  private requestStop() {
    if (this.stopping) return;
    const deadline = setTimeout(() => app.exit(1), 5000);
    this.stopping = this.close();
    void this.stopping.then(
      () => {
        clearTimeout(deadline);
        app.quit();
      },
      () => {
        clearTimeout(deadline);
        app.exit(1);
      },
    );
  }
  private async close() {
    // Startup may still be acquiring the Host; wait before releasing that resource.
    await this.starting?.catch(() => {
      /* run() reports startup failure. */
    });
    this.disposeBridge?.();
    if (app.isReady()) clearSessionHandlers();
    app.off('window-all-closed', this.onWindowClosed);
    app.off('before-quit', this.onBeforeQuit);
    await this.host?.close();
  }
}
