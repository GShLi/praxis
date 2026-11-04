import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireAcceptedBytes } from '../scripts/release/inventory.ts';

test('release refuses files replaced or added after acceptance', () => {
  const accepted = [{ name: 'praxis-cli.tar.gz', size: 10, sha256: 'abc' }];
  assert.doesNotThrow(() => requireAcceptedBytes(accepted, accepted));
  assert.throws(
    () => requireAcceptedBytes([{ ...accepted[0]!, sha256: 'def' }], accepted),
    /changed after/,
  );
  assert.throws(() => requireAcceptedBytes([], []), /changed after/);
  assert.throws(() => requireAcceptedBytes([...accepted, ...accepted], accepted), /changed after/);
});
