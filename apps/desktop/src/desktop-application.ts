import { startHost } from '@praxis/client-host';
import { safeError } from '@praxis/contracts';
import { app, dialog, type BrowserWindow, type MessageBoxOptions } from 'electron';
import path from 'node:path';
import { installBridge } from './bridge.ts';
import { DesktopCloseController } from './desktop-close-controller.ts';
import { DesktopCloseGuard } from './desktop-close-guard.ts';
import {
  inspectDesktopCloseActivity,
  type DesktopCloseActivity,
} from './desktop-close-inspection.ts';
import { clearSessionHandlers, createWindow } from './window.ts';

export class DesktopApplication {
  private host: Awaited<ReturnType<typeof startHost>> | undefined;
  private window: BrowserWindow | undefined;
  private disposeBridge: (() => void) | undefined;
  private starting: Promise<void> | undefined;
  private closeGuard: DesktopCloseGuard | undefined;
  private readonly closeController = new DesktopCloseController({
    ready: async () => {
      // Startup may still acquire a Host. run() reports a failed acquisition.
      await this.starting?.catch(() => {
        /* run() reports the error; partially acquired resources still need closing. */
      });
    },
    inspect: () => inspectDesktopCloseActivity(this.host?.rpc),
    confirm: (activity) => this.confirmTaskShutdown(activity),
    closeWindow: () => this.closeGuard?.close() ?? Promise.resolve(true),
    stopHost: () => this.stopHost(),
    finish: (code) => this.finishQuit(code),
    reportError: (error) => {
      const safe = safeError(error);
      if (this.window && !this.window.isDestroyed())
        dialog.showErrorBox('Praxis 退出失败', `${safe.code}: ${safe.safeMessage}`);
      else console.error('Desktop quit failed:', safe.code);
    },
  });
  async run(directory: string) {
    app.on('window-all-closed', this.onWindowClosed);
    app.on('before-quit', this.onBeforeQuit);
    this.starting = this.start(directory);
    try {
      await this.starting;
    } catch (error) {
      const safe = safeError(error);
      dialog.showErrorBox('Praxis 启动失败', `${safe.code}: ${safe.safeMessage}`);
      this.requestClose();
    }
  }
  private async start(directory: string) {
    await app.whenReady();
    if (this.closeController.pending) return;
    this.host = await startHost(
      'desktop',
      {
        PRAXIS_DATA_DIR: app.getPath('userData'),
        PRAXIS_NATIVE_DIR: path.resolve(directory, '../../build/native'),
      },
      path.resolve(directory, '../node/host.mjs'),
    );
    this.window = createWindow(directory);
    this.window.once('closed', () => {
      this.window = undefined;
    });
    this.closeGuard = new DesktopCloseGuard(this.window, this.requestClose, () =>
      this.confirmDiscard(),
    );
    this.disposeBridge = installBridge(this.window, this.host);
    await this.window.loadFile(path.resolve(directory, '../web/index.html'));
  }
  private onWindowClosed = () => this.requestClose();
  private onBeforeQuit = (event: Electron.Event) => {
    event.preventDefault();
    this.requestClose();
  };
  private requestClose = () => {
    void this.closeController.request().catch((error) => {
      // Last-resort reporting if Electron itself fails while presenting an error or quitting.
      console.error('Desktop quit failed:', safeError(error).code);
    });
  };
  private async confirmTaskShutdown(activity: DesktopCloseActivity) {
    const options: MessageBoxOptions = {
      type: 'warning',
      title: '退出 Praxis',
      message:
        activity.kind === 'known'
          ? `还有 ${activity.activeCount} 个任务未结束，停止任务并退出？`
          : '无法确认当前任务状态，仍要退出？',
      detail: '退出会停止此客户端的本地任务。会话历史会保留，下次打开后需手动继续。',
      buttons: ['取消', '停止任务并退出'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    const result =
      this.window && !this.window.isDestroyed()
        ? await dialog.showMessageBox(this.window, options)
        : await dialog.showMessageBox(options);
    return result.response === 1;
  }
  private confirmDiscard() {
    if (!this.window || this.window.isDestroyed()) return false;
    return (
      dialog.showMessageBoxSync(this.window, {
        type: 'warning',
        title: '退出 Praxis',
        message: '放弃未保存的更改并退出？',
        detail: '未保存的更改或正在保存的内容可能丢失。',
        buttons: ['取消', '放弃更改并退出'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      }) === 1
    );
  }
  private async stopHost() {
    try {
      this.closeGuard?.dispose();
      this.disposeBridge?.();
      if (app.isReady()) clearSessionHandlers();
    } finally {
      await this.host?.close();
    }
  }
  private finishQuit(code: 0 | 1) {
    app.off('window-all-closed', this.onWindowClosed);
    app.off('before-quit', this.onBeforeQuit);
    if (code === 0) app.quit();
    else app.exit(code);
  }
}
