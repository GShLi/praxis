import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge, HostMethod } from '../../../packages/ui/src/client.ts';

const bridge: DesktopBridge = {
  call<T>(method: HostMethod, params: unknown = {}): Promise<T> {
    return ipcRenderer.invoke('praxis:call', method, params) as Promise<T>;
  },
  subscribe(listener) {
    const callback = (_event: Electron.IpcRendererEvent, method: string, payload: unknown) =>
      listener(method, payload);
    ipcRenderer.on('praxis:event', callback);
    return () => ipcRenderer.removeListener('praxis:event', callback);
  },
  selectWorkspace(): Promise<string | null> {
    return ipcRenderer.invoke('praxis:select-workspace') as Promise<string | null>;
  },
};
contextBridge.exposeInMainWorld('praxis', Object.freeze(bridge));
