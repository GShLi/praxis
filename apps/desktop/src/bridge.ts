import type { startHost } from '@praxis/client-host';
import { assert, safeError } from '@praxis/contracts';
import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
const allowed = new Set([
  'auth/bind',
  'auth/me',
  'provider/delete',
  'host/diagnostics',
  'host/diagnostics-export',
  'user-instructions/read',
  'user-instructions/save',
  'plugin/list',
  'plugin/inspect',
  'plugin/install',
  'plugin/set-enabled',
  'plugin/commands',
  'plugin/run-command',
  'mcp/credential-set',
  'mcp/credential-clear',
  'mcp/oauth-start',
  'mcp/oauth-status',
  'mcp/oauth-cancel',
  'mcp/server-list',
  'mcp/server-upsert',
  'mcp/server-delete',
  'mcp/server-disable',
  'mcp/server-enable',
  'mcp/test',
  'mcp/prompt-list',
  'mcp/prompt-preview',
  'mcp/prompt-apply',
  'mcp/prompt-cancel',
  'auth/clear',
  'workspace/open',
  'provider/list',
  'provider/models',
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
  'approval/respond',
  'artifact/read',
]);

export function installBridge(window: BrowserWindow, host: Awaited<ReturnType<typeof startHost>>) {
  const trusted = (event: Electron.IpcMainInvokeEvent) =>
    assert(
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
      return await host.rpc.request(method, params);
    } catch (error) {
      const safe = safeError(error);
      throw new Error(`${safe.code}: ${safe.safeMessage}`);
    }
  });
  ipcMain.handle('praxis:select-workspace', async (event) => {
    trusted(event);
    const result = await dialog.showOpenDialog(window, {
      title: '选择 Agent 工作区',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  const notification = (method: string, payload: unknown) => {
    if (!window?.isDestroyed() && ['session/event', 'session/delta'].includes(method))
      window?.webContents.send('praxis:event', method, payload);
  };
  host.rpc.on('notification', notification);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url))
      void shell
        .openExternal(url)
        .catch(() => dialog.showErrorBox('打开链接失败', '无法调用默认浏览器。'));
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());

  return () => {
    ipcMain.removeHandler('praxis:call');
    ipcMain.removeHandler('praxis:select-workspace');
    host.rpc.off('notification', notification);
  };
}
