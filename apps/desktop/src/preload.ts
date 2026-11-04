import type { DesktopBridge, HostMethod } from '@praxis/ui/client';
import { readDesktopReply } from '@praxis/ui/client';
import { contextBridge, ipcRenderer } from 'electron';

const bridge: DesktopBridge = {
  call<T>(method: HostMethod, params: unknown = {}): Promise<T> {
    return invoke<T>('praxis:call', method, params);
  },
  subscribe(listener) {
    const callback = (_event: Electron.IpcRendererEvent, method: string, payload: unknown) =>
      listener(method, payload);
    ipcRenderer.on('praxis:event', callback);
    return () => ipcRenderer.removeListener('praxis:event', callback);
  },
  selectWorkspace(): Promise<string | null> {
    return invoke<string | null>('praxis:select-workspace');
  },
  selectPluginDirectory(): Promise<string | null> {
    return invoke<string | null>('praxis:select-plugin-directory');
  },
};
contextBridge.exposeInMainWorld('praxis', Object.freeze(bridge));

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  let reply: unknown;
  try {
    reply = await ipcRenderer.invoke(channel, ...args);
  } catch {
    // Transport failure contains Electron internals, not the Host's safe error contract.
    throw new Error('桌面服务连接失败，请重新启动应用。');
  }
  return readDesktopReply<T>(reply);
}
