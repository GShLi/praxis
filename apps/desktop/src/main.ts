import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseSmoke } from './release-smoke.ts';
import { DesktopApplication } from './desktop-application.ts';
async function main() {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  if (process.argv.includes('--praxis-release-smoke')) await releaseSmoke(directory);
  else await new DesktopApplication().run(directory);
}
void main();
