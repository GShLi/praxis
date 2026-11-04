import { startHost } from '@praxis/client-host';
import { app } from 'electron';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { createWindow, clearSessionHandlers } from './window.ts';
import { installBridge } from './bridge.ts';

/** Explicit acceptance mode uses fresh data, the real renderer/preload and packaged Host. */
export async function releaseSmoke(directory: string) {
  const root = process.env.PRAXIS_RELEASE_SMOKE_ROOT;
  if (!root || !path.isAbsolute(root))
    throw new Error('Acceptance requires an isolated parent-owned directory');
  const data = await mkdtemp(path.join(root, 'praxis-desktop-acceptance-'));
  app.setPath('userData', data);
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  let dispose: (() => void) | undefined;
  let window: ReturnType<typeof createWindow> | undefined;
  let passed = false;
  const deadline = setTimeout(() => app.exit(1), 45000);
  try {
    await app.whenReady();
    host = await startHost(
      'desktop',
      { PRAXIS_DATA_DIR: data, PRAXIS_NATIVE_DIR: path.resolve(directory, '../../build/native') },
      path.resolve(directory, '../node/host.mjs'),
    );
    window = createWindow(directory);
    window.hide();
    dispose = installBridge(window, host);
    await window.loadFile(path.resolve(directory, '../web/index.html'));
    const result = await window.webContents.executeJavaScript(`(async () => {
      const diagnostics = await window.praxis.call('host/diagnostics');
      const deadline = Date.now() + 10000;
      while (!document.querySelector('input') && Date.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 50));
      return { diagnostics, rendered: !!document.querySelector('input'), isolated: typeof window.require === 'undefined' };
    })()`);
    if (!result.rendered || !result.isolated || result.diagnostics.authenticated !== false)
      throw new Error('Packaged renderer/preload/Host acceptance failed');
    console.log('PRAXIS_DESKTOP_SMOKE_OK');
    passed = true;
  } finally {
    dispose?.();
    window?.destroy();
    if (app.isReady()) clearSessionHandlers();
    await host?.close();
    clearTimeout(deadline);
    // Chromium releases userData locks on exit; the parent removes its temporary root.
    app.exit(passed ? 0 : 1);
  }
}
