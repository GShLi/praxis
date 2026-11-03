import { readlink, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { mountView, viewFixture } from './linux-view-fixture.ts';

// Fixed trusted probe inside private user/pid/mount namespaces; it never launches user code.
const fixture = await viewFixture();
await writeFile(path.join(fixture.workspace, 'hello.txt'), 'namespace probe');
const view = await mountView(fixture);
process.stdout.write(JSON.stringify({ namespace: await readlink('/proc/self/ns/pid') }) + '\n');
const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  if (line === 'crash-view') {
    view.child.once('close', () => process.exit(70));
    view.child.kill('SIGKILL');
    break;
  }
}
