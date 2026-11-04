import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DesktopCloseController,
  inspectDesktopCloseActivity,
  type DesktopCloseActivity,
} from './desktop-close-fixture.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const events: string[] = [];
  const state = {
    activity: { kind: 'known', activeCount: 2 } as DesktopCloseActivity,
    allowTasks: true,
    allowUnload: true,
    hostOpen: true,
    windowOpen: true,
    bridgeOpen: true,
  };
  const boundary = {
    ready: async () => {
      events.push('ready');
    },
    inspect: async () => {
      events.push('inspect');
      return state.activity;
    },
    confirm: async (activity: DesktopCloseActivity) => {
      events.push(`confirm:${activity.kind}`);
      return state.allowTasks;
    },
    closeWindow: async () => {
      events.push('unload');
      if (state.allowUnload) state.windowOpen = false;
      return state.allowUnload;
    },
    stopHost: async () => {
      assert.equal(state.windowOpen, false, 'Host must outlive renderer unload approval');
      events.push('stop');
      state.hostOpen = false;
      state.bridgeOpen = false;
    },
    finish: (code: 0 | 1) => {
      events.push(`exit:${code}`);
    },
    reportError: (_error: unknown) => {
      events.push('error');
    },
  };
  return { state, boundary, events };
}

test('concurrent window and app quit requests share confirmation and close Host once', async () => {
  const f = fixture();
  const answer = deferred<boolean>();
  f.boundary.confirm = async () => {
    f.events.push('confirm');
    return answer.promise;
  };
  const controller = new DesktopCloseController(f.boundary);
  const first = controller.request();
  assert.equal(controller.request(), first);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.state.hostOpen, true);
  assert.equal(f.state.windowOpen, true);
  answer.resolve(true);
  assert.equal(await first, 'closed');
  assert.equal(await controller.request(), 'closed');
  assert.deepEqual(f.events, ['ready', 'inspect', 'confirm', 'unload', 'stop', 'exit:0']);
});

test('denying task shutdown keeps Host, bridge and window intact and permits a fresh attempt', async () => {
  const f = fixture();
  f.state.allowTasks = false;
  const controller = new DesktopCloseController(f.boundary);
  assert.equal(await controller.request(), 'cancelled');
  assert.equal(controller.pending, false);
  assert.equal(f.state.hostOpen && f.state.windowOpen && f.state.bridgeOpen, true);
  assert.deepEqual(f.events, ['ready', 'inspect', 'confirm:known']);
  f.state.allowTasks = true;
  assert.equal(await controller.request(), 'closed');
  assert.equal(f.events.filter((event) => event === 'stop').length, 1);
});

test('dirty beforeunload cancellation after task approval does not dispose anything', async () => {
  const f = fixture();
  f.state.allowUnload = false;
  const controller = new DesktopCloseController(f.boundary);
  assert.equal(await controller.request(), 'cancelled');
  assert.equal(f.state.hostOpen && f.state.windowOpen && f.state.bridgeOpen, true);
  assert.deepEqual(f.events, ['ready', 'inspect', 'confirm:known', 'unload']);
  f.state.allowUnload = true;
  assert.equal(await controller.request(), 'closed');
  assert.equal(f.events.filter((event) => event === 'confirm:known').length, 2);
});

test('unknown inspection requires explicit approval instead of treating it as zero tasks', async () => {
  const f = fixture();
  f.state.activity = { kind: 'unknown' };
  f.state.allowTasks = false;
  assert.equal(await new DesktopCloseController(f.boundary).request(), 'cancelled');
  assert.deepEqual(f.events, ['ready', 'inspect', 'confirm:unknown']);
  assert.equal(f.state.hostOpen, true);
  f.state.allowTasks = true;
  assert.equal(await new DesktopCloseController(f.boundary).request(), 'closed');
});

test('no active tasks skips task prompt but still runs renderer unload before shutdown', async () => {
  const f = fixture();
  f.state.activity = { kind: 'known', activeCount: 0 };
  assert.equal(await new DesktopCloseController(f.boundary).request(), 'closed');
  assert.deepEqual(f.events, ['ready', 'inspect', 'unload', 'stop', 'exit:0']);
});

test('quit waits for startup to finish acquiring its Host before inspection and cleanup', async () => {
  const f = fixture();
  const startup = deferred<void>();
  f.boundary.ready = () => startup.promise;
  const controller = new DesktopCloseController(f.boundary);
  const closing = controller.request();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(controller.pending, true);
  assert.deepEqual(f.events, []);
  startup.resolve();
  assert.equal(await closing, 'closed');
  assert.deepEqual(f.events, ['inspect', 'confirm:known', 'unload', 'stop', 'exit:0']);
});

test('failed startup with no Host or window still completes quit without task or unload prompts', async () => {
  const f = fixture();
  const startup = deferred<void>();
  f.boundary.ready = () =>
    startup.promise.catch(() => {
      f.events.push('startup-failed');
    });
  f.boundary.inspect = () => inspectDesktopCloseActivity(undefined);
  f.boundary.closeWindow = async () => {
    f.state.windowOpen = false;
    return true;
  };
  const controller = new DesktopCloseController(f.boundary);
  const closing = controller.request();
  startup.reject(new Error('Host startup failed'));
  assert.equal(await closing, 'closed');
  assert.deepEqual(f.events, ['startup-failed', 'stop', 'exit:0']);
});

test('a failing shutdown error reporter cannot prevent the final exit', async () => {
  const f = fixture();
  f.boundary.stopHost = async () => {
    throw new Error('shutdown failed');
  };
  f.boundary.reportError = () => {
    throw new Error('reporter failed');
  };
  const controller = new DesktopCloseController(f.boundary);
  await assert.rejects(controller.request(), /reporter failed/);
  assert.equal(f.events.filter((event) => event === 'exit:1').length, 1);
});

test('shutdown timeout is armed only after unload and exits once despite late Host completion', async () => {
  const f = fixture();
  const unload = deferred<boolean>();
  const stopped = deferred<void>();
  f.boundary.closeWindow = () => unload.promise;
  f.boundary.stopHost = () => {
    f.events.push('stop');
    return stopped.promise;
  };
  const controller = new DesktopCloseController(f.boundary, 5);
  const closing = controller.request();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(f.events.includes('stop'), false);
  assert.equal(
    f.events.some((event) => event.startsWith('exit')),
    false,
  );
  unload.resolve(true);
  assert.equal(await closing, 'failed');
  stopped.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(await controller.request(), 'failed');
  assert.deepEqual(f.events, ['ready', 'inspect', 'confirm:known', 'stop', 'error', 'exit:1']);
});

test('shutdown rejection exits once, while a prompt failure leaves the live application intact', async () => {
  const f = fixture();
  f.boundary.confirm = async () => {
    throw new Error('dialog failed');
  };
  const controller = new DesktopCloseController(f.boundary);
  assert.equal(await controller.request(), 'cancelled');
  assert.equal(f.state.hostOpen && f.state.windowOpen && f.state.bridgeOpen, true);
  f.boundary.confirm = async () => true;
  f.boundary.stopHost = async () => {
    f.events.push('stop');
    throw new Error('shutdown failed');
  };
  assert.equal(await controller.request(), 'failed');
  assert.equal(await controller.request(), 'failed');
  assert.equal(f.events.filter((event) => event === 'stop').length, 1);
  assert.equal(f.events.filter((event) => event === 'exit:1').length, 1);
});
