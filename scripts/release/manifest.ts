import { artifactInventory, requireAcceptedBytes } from './inventory.ts';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { artifacts, platform, projectManifest, releaseRoot, stage } from './layout.ts';
import { run } from './process.ts';

const { version } = await projectManifest();
const acceptance = JSON.parse(
  await readFile(path.join(releaseRoot, `acceptance-${platform}.json`), 'utf8'),
);
if (!acceptance.passed || !acceptance.installerTested || acceptance.version !== version)
  throw new Error('Missing matching installation acceptance');
const verification = JSON.parse(
  await readFile(path.join(releaseRoot, `verification-${platform}.json`), 'utf8'),
);
if (verification.signed !== (process.env.PRAXIS_RELEASE_SIGNED === '1'))
  throw new Error('Signature verification mode mismatch');
const current = await artifactInventory(artifacts);
requireAcceptedBytes(current, verification.artifacts);
requireAcceptedBytes(current, acceptance.artifacts);
await copyFile(
  path.join(releaseRoot, `acceptance-${platform}.json`),
  path.join(artifacts, `acceptance-${platform}.json`),
);
await copyFile(
  path.join(stage, 'cli/dependencies.json'),
  path.join(artifacts, `dependencies-${platform}.json`),
);
const files = [];
for (const name of (await readdir(artifacts)).sort()) {
  if (name.startsWith('SHA256SUMS') || name.startsWith('release-manifest')) continue;
  const bytes = await readFile(path.join(artifacts, name));
  files.push({
    name,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
const manifest = {
  version,
  platform,
  revision: (await run('git', ['rev-parse', 'HEAD'])).trim(),
  dirty: Boolean((await run('git', ['status', '--porcelain'])).trim()),
  signature:
    process.env.PRAXIS_RELEASE_SIGNED === '1'
      ? process.platform === 'linux'
        ? 'github-attestation-required'
        : 'platform-verified'
      : 'unsigned-candidate',
  files,
};
await writeFile(
  path.join(artifacts, `release-manifest-${platform}.json`),
  JSON.stringify(manifest, null, 2),
);
await writeFile(
  path.join(artifacts, `SHA256SUMS-${platform}.txt`),
  files.map((file) => `${file.sha256}  ${file.name}\n`).join(''),
);
console.log(`Release manifest created for ${platform}`);
