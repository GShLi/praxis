import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export interface ArtifactRecord {
  name: string;
  size: number;
  sha256: string;
}
export async function artifactInventory(directory: string): Promise<ArtifactRecord[]> {
  const files: ArtifactRecord[] = [];
  for (const name of (await readdir(directory)).sort()) {
    if (!/^praxis-.*\.(tar\.gz|zip|dmg|exe|AppImage)$/.test(name)) continue;
    const file = path.join(directory, name);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    files.push({ name, size: (await stat(file)).size, sha256: hash.digest('hex') });
  }
  return files;
}
export function requireAcceptedBytes(current: ArtifactRecord[], accepted: ArtifactRecord[]) {
  if (!current.length || JSON.stringify(current) !== JSON.stringify(accepted))
    throw new Error('Artifacts changed after installation acceptance or signature verification');
}
