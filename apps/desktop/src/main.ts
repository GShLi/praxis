import { app, BrowserWindow, dialog, ipcMain, shell, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHost } from '../../../packages/client-host/src/index.ts';
import { assert, safeError } from '../../../packages/contracts/src/index.ts';

const allowed = new Set([
  'auth/bind',
  'auth/clear',
  'workspace/open',
  'provider/list',
  'provider/save',
  'provider/select',
  'session/create',
  'session/list',
  'session/read',
  'session/prompt',
  'session/cancel',
  'session/subscribe',
  'session/unsubscribe',
  'session/set-permissions',
  'session/archive',
  'session/delete',
  'question/respond',
  'artifact/read',
]);
let window: BrowserWindow | undefined;
let host: Awaited<ReturnType<typeof startHost>> | undefined;
let exiting = false;
async function main() {
  await app.whenReady();
  const directory = path.dirname(fileURLToPath(import.meta.url));
  host = await startHost(
    'desktop',
    {
      PRAXIS_DATA_DIR: app.getPath('userData'),
      PRAXIS_NATIVE_DIR: path.resolve(directory, '../../build/native'),
    },
    path.resolve(directory, '../node/host.mjs'),
  );
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 540,
    title: '知行 Praxis',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(directory, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'",
        ],
      },
    }),
  );
  const trusted = (event: Electron.IpcMainInvokeEvent) =>
    assert(
      window &&
        event.sender === window.webContents &&
        event.senderFrame === window.webContents.mainFrame &&
        event.senderFrame.url === window.webContents.getURL(),
      'FORBIDDEN',
      '不可信窗口调用。',
    );
  ipcMain.handle('praxis:call', async (event, method: unknown, params: unknown) => {
    trusted(event);
    assert(
      typeof method === 'string' && allowed.has(method),
      'METHOD_NOT_FOUND',
      '此界面方法不可用。',
    );
    try {
      return await host!.rpc.request(method, params);
    } catch (error) {
      const safe = safeError(error);
      throw new Error(`${safe.code}: ${safe.safeMessage}`);
    }
  });
  ipcMain.handle('praxis:select-workspace', async (event) => {
    trusted(event);
    const result = await dialog.showOpenDialog(window!, {
      title: '选择 Agent 工作区',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  host.rpc.on('notification', (method: string, payload: unknown) => {
    if (!window?.isDestroyed() && ['session/event', 'session/delta'].includes(method))
      window?.webContents.send('praxis:event', method, payload);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  await window.loadFile(path.resolve(directory, '../web/index.html'));
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (exiting) return;
  event.preventDefault();
  exiting = true;
  const deadline = setTimeout(() => app.exit(1), 5000);
  void host?.close().finally(() => {
    clearTimeout(deadline);
    app.quit();
  });
  if (!host) {
    clearTimeout(deadline);
    app.quit();
  }
});
main().catch((error: unknown) => {
  const safe = safeError(error);
  dialog.showErrorBox('Praxis 启动失败', `${safe.code}: ${safe.safeMessage}`);
  app.quit();
});
