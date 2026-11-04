import assert from 'node:assert/strict';
import { artifactInventory, requireAcceptedBytes } from './inventory.ts';
import { installDesktop } from './install-desktop.ts';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { artifacts, platform, projectManifest, releaseRoot } from './layout.ts';
import { run } from './process.ts';

function isolatedEnvironment(data: string) {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (/^(PRAXIS_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/.test(key)) delete env[key];
  return { ...env, PRAXIS_DATA_DIR: data };
}

const temporary = await mkdtemp(path.join(os.tmpdir(), 'praxis installed-'));
try {
  const { version } = await projectManifest();
  const before = await artifactInventory(artifacts);
  const installed = path.join(temporary, 'installed');
  await mkdir(installed);
  for (const kind of ['cli', 'server'])
    await run('tar', [
      '-xzf',
      path.join(artifacts, `praxis-${kind}-${version}-${platform}.tar.gz`),
      '-C',
      installed,
    ]);
  const env = {
    ...isolatedEnvironment(path.join(temporary, 'data')),
    PRAXIS_RELEASE_SMOKE_ROOT: temporary,
  };
  const cli = path.join(installed, 'cli/bin/praxis.cjs');
  assert.match(await run(process.execPath, [cli, '--help'], { cwd: temporary, env }), /Praxis/);
  const diagnostics = JSON.parse(
    await run(process.execPath, [cli, 'doctor'], { cwd: temporary, env }),
  );
  assert.equal(diagnostics.platform, process.platform);
  assert.equal(diagnostics.authenticated, false);
  // keygen exercises server runtime dependency loading without a production DB or secret.
  const key = (
    await run(process.execPath, [path.join(installed, 'server/dist/node/server.mjs'), 'keygen'], {
      cwd: temporary,
      env,
    })
  ).trim();
  assert.equal(Buffer.from(key, 'base64').length, 32);
  const desktop = await installDesktop(temporary);
  try {
    const output = await run(desktop.executable, ['--praxis-release-smoke'], {
      cwd: temporary,
      env,
      timeout: 60000,
    });
    assert.match(output, /PRAXIS_DESKTOP_SMOKE_OK/);
  } finally {
    await desktop.close();
  }
  requireAcceptedBytes(await artifactInventory(artifacts), before);
  await writeFile(
    path.join(releaseRoot, `acceptance-${platform}.json`),
    JSON.stringify(
      {
        version,
        platform,
        passed: true,
        installerTested: desktop.installer,
        artifacts: before,
        checks: [
          'extracted-cli-help',
          'extracted-cli-host-handshake',
          'extracted-server-load',
          'packaged-desktop-renderer-preload-host',
        ],
        limitation:
          'Does not replace interactive installer wizard or real-model feature acceptance.',
      },
      null,
      2,
    ),
  );
  console.log(`Installed distribution acceptance passed: ${platform}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
