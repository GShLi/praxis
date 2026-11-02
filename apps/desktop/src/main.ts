import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopApplication } from './desktop-application.ts';
async function main() {
  await new DesktopApplication().run(path.dirname(fileURLToPath(import.meta.url)));
}
void main();
