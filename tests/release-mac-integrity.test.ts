import assert from 'node:assert/strict';
import { access, rm, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { verifyMacCode } from '../scripts/release/mac-integrity.ts';
import { run } from '../scripts/release/process.ts';
import { macIntegrityFixture } from './fixtures/release-mac-app.ts';

test(
  'macOS release verification requires an intact bundle resource seal even for ad-hoc signatures',
  { skip: process.platform !== 'darwin', timeout: 60_000 },
  async () => {
    const fixture = await macIntegrityFixture();
    try {
      // The linker-signed executable is valid on its own, but the app has no resource seal.
      await run('/usr/bin/codesign', ['--verify', '--strict', fixture.standalone]);
      await assert.rejects(access(fixture.codeResources), { code: 'ENOENT' });
      await assert.rejects(verifyMacCode(fixture.app), /code has no resources/i);

      await fixture.sign();
      await access(fixture.codeResources);
      await verifyMacCode(fixture.app);

      await writeFile(fixture.resource, 'modified resource\n');
      await assert.rejects(verifyMacCode(fixture.app), /resource.*(?:invalid|modified)/i);

      // Restore a valid seal before removing it, so this failure is independent of tampering.
      await fixture.sign();
      await verifyMacCode(fixture.app);
      await rm(fixture.codeResources);
      await assert.rejects(
        verifyMacCode(fixture.app),
        /code has no resources|invalid resource directory/i,
      );
    } finally {
      await fixture.close();
    }
  },
);
