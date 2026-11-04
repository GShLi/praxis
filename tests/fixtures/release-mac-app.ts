import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run } from '../../scripts/release/process.ts';

const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>integrity-fixture</string>
  <key>CFBundleIdentifier</key><string>test.praxis.integrity-fixture</string>
  <key>CFBundleName</key><string>Integrity Fixture</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
</dict></plist>
`;

/** A disposable real Mach-O bundle; no installed application or signing identity is used. */
export async function macIntegrityFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis mac integrity-'));
  const app = path.join(root, 'TinyMac.app');
  const contents = path.join(app, 'Contents');
  const executable = path.join(contents, 'MacOS', 'integrity-fixture');
  const resource = path.join(contents, 'Resources', 'payload.txt');
  try {
    await mkdir(path.dirname(executable), { recursive: true });
    await mkdir(path.dirname(resource), { recursive: true });
    await writeFile(path.join(contents, 'Info.plist'), infoPlist);
    await writeFile(resource, 'original resource\n');
    const source = path.join(root, 'main.c');
    const standalone = path.join(root, 'integrity-fixture');
    await writeFile(source, 'int main(void) { return 0; }\n');
    // Explicitly request linker ad-hoc signing on both arm64 and x64, without sealing the bundle.
    await run('/usr/bin/cc', [source, '-Wl,-adhoc_codesign', '-o', standalone]);
    await copyFile(standalone, executable);
    return {
      app,
      standalone,
      resource,
      codeResources: path.join(contents, '_CodeSignature', 'CodeResources'),
      sign: () => run('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', app]),
      close: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
