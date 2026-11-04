import { cp, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { artifacts, desktopExecutable } from './layout.ts';
import { run } from './process.ts';
import { verifyMacCode } from './mac-integrity.ts';

/** Install into an isolated destination; do not overwrite a user's application or data. */
export async function installDesktop(temporary: string) {
  const files = await readdir(artifacts);
  const extension =
    process.platform === 'darwin' ? '.dmg' : process.platform === 'win32' ? '.exe' : '.AppImage';
  const installer = files.find(
    (name) => name.startsWith('praxis-desktop-') && name.endsWith(extension),
  );
  if (!installer)
    return { executable: desktopExecutable(), installer: false, close: async () => {} };
  const file = path.join(artifacts, installer);
  const destination = path.join(temporary, 'desktop-install');
  await mkdir(destination);
  if (process.platform === 'darwin') return installMac(file, destination);
  if (process.platform === 'win32') return installWindows(file, destination);
  await run(file, ['--appimage-extract'], { cwd: destination, timeout: 120000 });
  return {
    executable: path.join(destination, 'squashfs-root/praxis'),
    installer: true,
    close: async () => {},
  };
}

async function installMac(file: string, destination: string) {
  const mount = path.join(destination, 'mounted');
  await mkdir(mount);
  await run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, file]);
  try {
    await cp(path.join(mount, 'Praxis.app'), path.join(destination, 'Praxis.app'), {
      recursive: true,
      verbatimSymlinks: true,
    });
  } finally {
    await run('hdiutil', ['detach', mount]);
  }
  await verifyMacCode(path.join(destination, 'Praxis.app'));
  return {
    executable: path.join(destination, 'Praxis.app/Contents/MacOS/Praxis'),
    installer: true,
    close: async () => {},
  };
}

async function installWindows(file: string, destination: string) {
  if (process.env.PRAXIS_RELEASE_DISPOSABLE_WINDOWS !== '1')
    throw new Error(
      'NSIS acceptance requires a disposable Windows account: PRAXIS_RELEASE_DISPOSABLE_WINDOWS=1',
    );
  await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "$roots = @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'); foreach ($root in $roots) { $items = Get-ItemProperty $root -ErrorAction SilentlyContinue; if ($items | Where-Object { $_.DisplayName -eq 'Praxis' }) { throw 'Existing Praxis installation: use a clean disposable account' } }",
  ]);

  await run(file, ['/S', `/D=${destination}`], { timeout: 180000, windowsVerbatimArguments: true });
  return {
    executable: path.join(destination, 'Praxis.exe'),
    installer: true,
    close: async () => {
      const uninstaller = (await readdir(destination)).find((name) =>
        /^Uninstall.*\.exe$/.test(name),
      );
      if (!uninstaller) throw new Error('Installed application has no uninstaller');
      // NSIS runs directly and waits instead of copying itself to a detached temp process.
      await run(path.join(destination, uninstaller), ['/S', `_?=${destination}`], {
        timeout: 120000,
        windowsVerbatimArguments: true,
      });
    },
  };
}
