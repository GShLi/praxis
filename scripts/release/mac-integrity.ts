import { run } from './process.ts';

/** Ad-hoc candidates still need a valid resource seal; trust/notarization is a separate gate. */
export async function verifyMacCode(file: string): Promise<void> {
  await run('codesign', ['--verify', '--deep', '--strict', file]);
}
