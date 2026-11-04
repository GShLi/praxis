import assert from 'node:assert/strict';
import { test } from 'node:test';
const { protectUnsavedForm } = await import(
  new URL('../packages/ui/src/settings/unsaved-form.ts', import.meta.url).href
);

function navigation(proceed: () => void) {
  return new CustomEvent('praxis:before-navigate', { cancelable: true, detail: { proceed } });
}
function reloadEvent() {
  const event = new Event('beforeunload', { cancelable: true });
  Object.defineProperty(event, 'returnValue', { value: '', writable: true });
  return event;
}

test('dirty navigation defers the requested action until explicit discard', () => {
  const target = new EventTarget();
  let proceeded = 0;
  const confirmations: Array<() => void> = [];
  const dispose = protectUnsavedForm(
    target,
    () => ({ dirty: true, busy: false }),
    (next: () => void) => confirmations.push(next),
  );
  assert.equal(target.dispatchEvent(navigation(() => proceeded++)), false);
  assert.equal(proceeded, 0);
  assert.equal(confirmations.length, 1);
  confirmations[0]!();
  assert.equal(proceeded, 1);
  dispose();
});

test('busy forms block navigation without allowing a discard continuation', () => {
  const target = new EventTarget();
  let confirmations = 0;
  const dispose = protectUnsavedForm(
    target,
    () => ({ dirty: true, busy: true }),
    () => confirmations++,
  );
  assert.equal(target.dispatchEvent(navigation(() => assert.fail('busy navigation'))), false);
  assert.equal(confirmations, 0);
  dispose();
});

test('reload protection tracks current dirty state and unregisters on unmount', () => {
  const target = new EventTarget();
  let dirty = true;
  const dispose = protectUnsavedForm(
    target,
    () => ({ dirty, busy: false }),
    () => {},
  );
  assert.equal(target.dispatchEvent(reloadEvent()), false);
  dirty = false;
  assert.equal(target.dispatchEvent(reloadEvent()), true);
  assert.equal(target.dispatchEvent(navigation(() => {})), true);
  dirty = true;
  dispose();
  assert.equal(target.dispatchEvent(navigation(() => {})), true);
  assert.equal(target.dispatchEvent(reloadEvent()), true);
});
