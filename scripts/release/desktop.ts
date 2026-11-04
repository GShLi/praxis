import { build, Platform, Arch, type Configuration } from 'electron-builder';
import path from 'node:path';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { artifacts, projectManifest, releaseRoot, stage } from './layout.ts';

const signed = process.env.PRAXIS_RELEASE_SIGNED === '1';
const directoryOnly = process.argv.includes('--dir');
const project = await projectManifest();
const electronVersion = project.devDependencies.electron;
if (!electronVersion) throw new Error('Electron version is required');
if (signed && process.platform === 'darwin' && !(process.env.CSC_LINK || process.env.CSC_NAME))
  throw new Error('Signed release requires Apple Developer ID via CSC_LINK or CSC_NAME');
if (signed && process.platform === 'win32' && !(process.env.WIN_CSC_LINK || process.env.CSC_LINK))
  throw new Error('Signed release requires Windows code-signing credentials');
const configuration: Configuration = {
  appId: 'app.praxis.desktop',
  productName: 'Praxis',
  executableName: 'praxis',
  electronVersion,
  directories: { app: path.join(stage, 'desktop'), output: path.join(releaseRoot, 'desktop') },
  files: ['**/*', '!**/*.map'],
  asar: false,
  npmRebuild: false,
  nodeGypRebuild: false,
  forceCodeSigning: signed && process.platform !== 'linux',
  artifactName: 'praxis-desktop-${version}-${os}-${arch}.${ext}',
  publish: null,
  mac: {
    target: ['dmg', 'zip'],
    category: 'public.app-category.productivity',
    hardenedRuntime: signed,
    notarize: signed,
    ...(signed ? {} : { identity: null }),
    entitlements: path.resolve('scripts/release/entitlements.mac.plist'),
    entitlementsInherit: path.resolve('scripts/release/entitlements.mac.plist'),
  },
  win: { target: ['nsis', 'zip'], executableName: 'Praxis', signExts: ['.exe'] },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
  },
  linux: { target: ['AppImage', 'tar.gz'], category: 'Development', executableName: 'praxis' },
};
const target =
  process.platform === 'darwin'
    ? Platform.MAC
    : process.platform === 'win32'
      ? Platform.WINDOWS
      : Platform.LINUX;
const arch = process.arch === 'arm64' ? Arch.arm64 : Arch.x64;
await rm(path.join(releaseRoot, 'desktop'), { recursive: true, force: true });
await build({
  config: configuration,
  targets: target.createTarget(directoryOnly ? ['dir'] : undefined, arch),
  publish: 'never',
});
if (!directoryOnly) {
  await mkdir(artifacts, { recursive: true });
  for (const file of await readdir(path.join(releaseRoot, 'desktop'))) {
    if (/^praxis-desktop-.*\.(dmg|zip|exe|AppImage|tar\.gz)$/.test(file))
      await cp(path.join(releaseRoot, 'desktop', file), path.join(artifacts, file));
  }
}
