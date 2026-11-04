import type { PraxisClient, Snapshot, ViewSession } from '@praxis/ui/client';
import type { Event } from '@praxis/contracts';
import { flushSync } from 'react-dom';
import { assert, deferred, mount, settle } from './ux-visual-browser.tsx';
import { settingsFixtureClient } from './settings-ux-fixture-client.ts';
import { event } from './task-presentation-fixtures.ts';

const { useAppController } = await import(
  new URL('../packages/ui/src/app/useAppController.ts', import.meta.url).href
);

const session = (id: string, kind: 'chat' | 'agent' = 'chat'): ViewSession => ({
  id,
  kind,
  title: id,
  status: 'idle',
});
const snapshot = (id: string): Snapshot => ({
  session: session(id),
  messages: [],
  throughSeq: 10,
  turnId: null,
});

function harness(overrides: Partial<PraxisClient> = {}) {
  let current: ReturnType<typeof useAppController>;
  const listeners = new Map<string, { event(value: Event): void; delta(value: string): void }>();
  const detached: string[] = [];
  const client: PraxisClient = {
    ...settingsFixtureClient(new URLSearchParams('client=web')),
    list: async () => [session('a'), session('b'), session('task', 'agent')],
    read: async (id) => snapshot(id),
    send: async () => {},
    logout: async () => {},
    listen: (id, _after, receive, delta) => {
      listeners.set(id, { event: receive, delta });
      return () => {
        detached.push(id);
      };
    },
    ...overrides,
  };
  function Probe() {
    current = useAppController(client);
    return (
      <>
        <div ref={current.scroll} />
        <textarea ref={current.input} />
      </>
    );
  }
  const root = mount(<Probe />);
  return { client, listeners, detached, root, state: () => current };
}

async function navigationAndSend() {
  const acceptance = deferred<void>();
  const sent: string[] = [];
  const fixture = harness({
    send: async (id, text) => {
      sent.push(`${id}:${text}`);
      await acceptance.promise;
    },
  });
  try {
    await settle();
    const state = fixture.state;
    assert(state().authenticated && state().providerId, 'identity/model did not load');
    flushSync(() => state().chooseSession(session('a')));
    await settle();
    flushSync(() => state().setDraft('original'));
    const sending = state().send();
    await settle();
    flushSync(() => state().setDraft('edited during send'));
    flushSync(() => state().chooseSession(session('b')));
    await settle();
    flushSync(() => {
      state().setDraft('other conversation');
      state().setFollow(false);
    });
    acceptance.resolve();
    await sending;
    await settle();
    assert(sent.join() === 'a:original', 'send lost its originating conversation/text');
    assert(state().draft === 'other conversation' && !state().follow, 'late send changed new view');
    flushSync(() => state().chooseSession(session('a')));
    assert(state().draft === 'edited during send', 'late acknowledgement erased newer draft');
    flushSync(() => state().setKind('agent'));
    flushSync(() => state().chooseSession(session('task', 'agent')));
    flushSync(() => state().setKind('chat'));
    assert(state().selected === 'a', 'mode switch lost remembered selection');
    flushSync(() => state().newSession());
    assert(state().selected === null && state().snapshot === null, 'new session retained history');
  } finally {
    fixture.root.unmount();
  }
}

async function subscriptionOrdering() {
  const reads = [deferred<Snapshot>(), deferred<Snapshot>(), deferred<Snapshot>()];
  let count = 0;
  const fixture = harness({
    read: async (id) => (id === 'a' ? reads[count++]!.promise : snapshot(id)),
  });
  try {
    await settle();
    flushSync(() => fixture.state().chooseSession(session('a')));
    await settle();
    reads[0]!.resolve(snapshot('a'));
    await settle();
    const listener = fixture.listeners.get('a');
    assert(listener, 'missing listener after initial snapshot');
    listener.delta('partial');
    listener.event(event('tool/result', 12, '2020-01-01T00:00:00Z'));
    await settle();
    assert(count === 3, 'gap and event refresh were not both scheduled');
    reads[2]!.resolve({
      ...snapshot('a'),
      messages: [{ id: 'new', role: 'assistant', content: 'new' }],
    });
    await settle();
    reads[1]!.resolve({
      ...snapshot('a'),
      messages: [{ id: 'old', role: 'assistant', content: 'old' }],
    });
    await settle();
    assert(
      fixture.state().snapshot.messages[0].id === 'new',
      'older refresh replaced newest result',
    );
    flushSync(() => fixture.state().chooseSession(session('b')));
    await settle();
    listener.delta('stale');
    listener.event(event('assistant/message', 13, '2020-01-01T00:00:00Z'));
    await settle();
    assert(fixture.detached.includes('a'), 'old listener was not detached');
    assert(
      fixture.state().snapshot.session.id === 'b' && fixture.state().partial === '',
      'old event changed selection',
    );
  } finally {
    fixture.root.unmount();
  }
}

async function identityInvalidation() {
  const pending = deferred<ViewSession[]>();
  const fixture = harness();
  try {
    await settle();
    fixture.client.list = () => pending.promise;
    const reload = fixture.state().reloadLists();
    await fixture.state().logout();
    await settle();
    pending.resolve([session('late')]);
    await reload;
    await settle();
    assert(
      !fixture.state().authenticated && fixture.state().sessions.length === 0,
      'late identity request restored signed-out data',
    );
  } finally {
    fixture.root.unmount();
  }
}

export async function run() {
  const failures: string[] = [];
  for (const check of [navigationAndSend, subscriptionOrdering, identityInvalidation]) {
    sessionStorage.clear();
    try {
      await check();
    } catch (error) {
      failures.push(`${check.name}: ${String(error)}`);
    }
  }
  return failures;
}
