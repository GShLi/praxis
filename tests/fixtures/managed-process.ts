import { ManagedProcesses, type CommandInput, type ProcessOptions } from '@praxis/tools/processes';
import { PraxisError } from '@praxis/contracts';
import { SessionStore, uuid } from '@praxis/storage-local';
import { commandBackend } from './command-backend.ts';

export function processFixture(denied = false, database = ':memory:') {
  const store = new SessionStore(database);
  const session = store.create('fixture', 'agent', '/fixture/workspace');
  const backend = commandBackend(),
    failures: unknown[] = [];
  const options: ProcessOptions = {
    store,
    sessionId: session.id,
    turnId: uuid(),
    deadline: Date.now() + 10000,
    backend: backend.backend,
    approve: async () => {
      if (denied) throw new PraxisError('APPROVAL_REJECTED', '拒绝');
      return () => {};
    },
    onFatal: (error: Error) => {
      failures.push(error);
    },
  };
  const service = new ManagedProcesses(options);
  const input: CommandInput = {
    kind: 'exec',
    executable: 'fixture',
    args: ['literal;value'],
    cwd: '.',
    description: 'fixture command',
    timeoutMs: 1000,
    yieldMs: 0,
    env: {},
  };
  return {
    store,
    session,
    backend,
    failures,
    service,
    options,
    input,
    signal: new AbortController().signal,
  };
}
