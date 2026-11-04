import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { DesktopCloseGuard, DesktopCloseController } from './desktop-close-fixture.ts';

function event() {
  return {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

class WindowBoundary extends EventEmitter {
  readonly contents = new EventEmitter();
  dirty = false;
  destroyed = false;
  unloads = 0;
  deferUnload = false;
  get webContents() {
    if (this.destroyed) throw new Error('Object has been destroyed');
    return this.contents;
  }
  isDestroyed() {
    return this.destroyed;
  }
  close() {
    const closing = event();
    this.emit('close', closing);
    if (closing.defaultPrevented) return;
    this.unloads++;
    if (this.deferUnload) return;
    this.completeUnload();
  }
  completeUnload() {
    if (this.dirty) {
      const veto = event();
      this.webContents.emit('will-prevent-unload', veto);
      if (!veto.defaultPrevented) return;
    }
    this.destroyed = true;
    this.emit('closed');
  }
}

test('a user window close is gated before Electron reaches renderer unload', () => {
  const window = new WindowBoundary();
  let requests = 0;
  const guard = new DesktopCloseGuard(
    window,
    () => {
      requests++;
    },
    () => false,
  );
  window.close();
  window.close();
  assert.equal(requests, 2);
  assert.equal(window.destroyed, false);
  assert.equal(window.unloads, 0);
  guard.dispose();
  assert.equal(window.listenerCount('close'), 0);
  assert.equal(window.listenerCount('closed'), 0);
  assert.equal(window.webContents.listenerCount('will-prevent-unload'), 0);
});

test('dirty unload Cancel preserves Host and window; fresh approval closes Host once after closed', async () => {
  const window = new WindowBoundary();
  window.dirty = true;
  let discard = false;
  let stops = 0;
  let prompts = 0;
  const guard = new DesktopCloseGuard(
    window,
    () => {
      void controller.request();
    },
    () => discard,
  );
  const controller = new DesktopCloseController({
    ready: async () => {},
    inspect: async () => ({ kind: 'known', activeCount: 1 }),
    confirm: async () => {
      prompts++;
      return true;
    },
    closeWindow: () => guard.close(),
    stopHost: async () => {
      assert.equal(window.destroyed, true);
      stops++;
      guard.dispose();
    },
    finish: () => {},
    reportError: (error) => {
      assert.fail(String(error));
    },
  });
  window.close();
  assert.equal(await controller.request(), 'cancelled');
  assert.equal(stops, 0);
  assert.equal(window.destroyed, false);
  discard = true;
  window.close();
  assert.equal(await controller.request(), 'closed');
  assert.equal(stops, 1);
  assert.equal(prompts, 2);
});

test('unload guard does not override dirty reload or navigation outside a close attempt', () => {
  const window = new WindowBoundary();
  let prompts = 0;
  const guard = new DesktopCloseGuard(
    window,
    () => {},
    () => {
      prompts++;
      return true;
    },
  );
  const veto = event();
  window.webContents.emit('will-prevent-unload', veto);
  assert.equal(veto.defaultPrevented, false);
  assert.equal(prompts, 0);
  guard.dispose();
});

test('missing or already closed renderer completes without a dirty prompt', async () => {
  const window = new WindowBoundary();
  const guard = new DesktopCloseGuard(
    window,
    () => {},
    () => assert.fail('unexpected prompt'),
  );
  window.destroyed = true;
  assert.equal(await guard.close(), true);
  guard.dispose();
});

test('concurrent requests during asynchronous unload share one close and release all listeners', async () => {
  const window = new WindowBoundary();
  window.deferUnload = true;
  let requests = 0;
  const guard = new DesktopCloseGuard(
    window,
    () => {
      requests++;
    },
    () => false,
  );
  const closing = guard.close();
  assert.equal(guard.close(), closing);
  window.close();
  assert.equal(requests, 1);
  assert.equal(window.unloads, 1);
  assert.equal(window.destroyed, false);
  window.completeUnload();
  assert.equal(await closing, true);
  guard.dispose();
  guard.dispose();
  assert.equal(window.listenerCount('close'), 0);
  assert.equal(window.listenerCount('closed'), 0);
  assert.equal(window.contents.listenerCount('will-prevent-unload'), 0);
});

test('failed native dirty confirmation keeps veto in force and allows retry', async () => {
  const window = new WindowBoundary();
  window.dirty = true;
  let fail = true;
  const guard = new DesktopCloseGuard(
    window,
    () => {},
    () => {
      if (fail) throw new Error('native dialog failed');
      return true;
    },
  );
  await assert.rejects(guard.close(), /native dialog failed/);
  assert.equal(window.destroyed, false);
  fail = false;
  assert.equal(await guard.close(), true);
  guard.dispose();
});
