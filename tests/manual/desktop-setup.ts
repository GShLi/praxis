import { startHost } from '@praxis/client-host';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Installs an explicitly labelled fixture into a disposable desktop profile only. */
export async function setupDesktop(root: string, serverUrl: string, praxisApiKey: string) {
  const source = path.join(root, 'plugin');
  const profile = path.join(root, 'profile');
  await mkdir(source);
  await mkdir(path.join(root, 'workspace'));
  await build({
    entryPoints: ['tests/manual/desktop-provider.ts'],
    outfile: path.join(source, 'plugin.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
  });
  await writeFile(
    path.join(source, 'praxis-plugin.json'),
    JSON.stringify({
      id: 'fixture.desktop',
      version: '1.0.0',
      sdkVersion: '^1.0.0',
      entry: 'plugin.mjs',
      runtimes: ['local-host'],
      modes: ['agent', 'chat'],
      platforms: ['darwin', 'linux', 'win32'],
      capabilities: ['model-provider'],
    }),
  );
  const host = await startHost('desktop', {
    PRAXIS_DATA_DIR: profile,
    PRAXIS_SECRET_STORE: 'memory',
  });
  try {
    await host.rpc.request('auth/bind', { serverUrl, praxisApiKey });
    const inspected = await host.rpc.request<{ digest: string }>('plugin/inspect', { source });
    await host.rpc.request('plugin/install', {
      source,
      expectedDigest: inspected.digest,
      expectedRevision: 0,
    });
    await host.rpc.request('plugin/set-enabled', {
      id: 'fixture.desktop',
      enabled: true,
      expectedRevision: 1,
    });
  } finally {
    await host.close();
  }
  const entry = path.join(root, 'desktop.mjs');
  const application = pathToFileURL(path.resolve('dist/desktop/main.mjs')).href;
  await writeFile(
    entry,
    `import {app} from 'electron';
app.setPath('userData', ${JSON.stringify(profile)});
process.env.PRAXIS_SECRET_STORE='memory';
await import(${JSON.stringify(application)});
`,
  );
  return entry;
}
