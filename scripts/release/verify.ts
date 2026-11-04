import { artifactInventory } from './inventory.ts';
import { copyFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  artifacts,
  desktopAppRoot,
  desktopExecutable,
  desktopResources,
  nativeNames,
  releaseRoot,
  platform,
  stage,
} from './layout.ts';
import { archiveApplications } from './stage.ts';
import { run } from './process.ts';
import { verifyMacCode } from './mac-integrity.ts';

const signed = process.env.PRAXIS_RELEASE_SIGNED === '1';
async function verifyWindows(file: string) {
  await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$s = Get-AuthenticodeSignature -LiteralPath $env:PRAXIS_VERIFY_FILE; if ($s.Status -ne "Valid") { throw "Invalid Authenticode signature" }',
    ],
    { env: { ...process.env, PRAXIS_VERIFY_FILE: file } },
  );
}
if (process.platform === 'darwin') await verifyMacCode(desktopAppRoot());
if (signed && process.platform === 'darwin') {
  await run('spctl', ['--assess', '--type', 'execute', desktopAppRoot()]);
  await run('xcrun', ['stapler', 'validate', desktopAppRoot()]);
}
if (signed && process.platform === 'win32') {
  await verifyWindows(desktopExecutable());
  for (const file of await readdir(artifacts))
    if (file.endsWith('.exe')) await verifyWindows(path.join(artifacts, file));
}
// CLI archives receive the exact helper bytes from the signed desktop payload.
for (const file of nativeNames()) {
  const source = path.join(desktopResources(), 'build/native', file);
  if (process.platform === 'darwin') await verifyMacCode(source);
  if (signed && process.platform === 'win32') await verifyWindows(source);
  await copyFile(source, path.join(stage, 'cli/build/native', file));
}
await archiveApplications();
await writeFile(
  path.join(releaseRoot, `verification-${platform}.json`),
  JSON.stringify({ signed, artifacts: await artifactInventory(artifacts) }),
);
console.log(
  signed
    ? 'Platform signature verification passed; archives rebuilt from verified helpers.'
    : 'UNSIGNED candidate: no trusted code-signature claim.',
);
