import type { CommandBackend, CommandExit, CommandPlan } from '@praxis/tools/processes';

/** Controlled lifecycle fixture, deliberately not an OS-isolation implementation. */
export function commandBackend(finishOnStop = false) {
  let output: ((stream: 'stdout' | 'stderr', data: Buffer) => void) | undefined;
  let resolveExit!: (exit: CommandExit) => void;
  const done = new Promise<CommandExit>((resolve) => {
    resolveExit = resolve;
  });
  const calls = { prepared: 0, started: 0, stopped: 0, closed: 0 };
  const backend: CommandBackend = {
    async prepare(input, context) {
      calls.prepared++;
      const plan: CommandPlan = {
        executable: '/fixture/command',
        args: input.kind === 'exec' ? input.args : [input.script],
        cwd: context.workspace,
        env: {},
        description: input.description,
        timeoutMs: input.timeoutMs,
        sandbox: {
          backend: 'test-fixture',
          policyVersion: 1,
          fileMode: context.permission.mode,
          network: 'deny',
        },
      };
      return {
        plan,
        async start(callback) {
          calls.started++;
          output = callback;
          return {
            done,
            async stop() {
              calls.stopped++;
              if (finishOnStop) resolveExit({ exitCode: 0, signal: null, cleanup: 'complete' });
            },
          };
        },
        async close() {
          calls.closed++;
        },
      };
    },
  };
  return {
    backend,
    calls,
    output: (stream: 'stdout' | 'stderr', text: string) => output?.(stream, Buffer.from(text)),
    finish: (exit: CommandExit = { exitCode: 0, signal: null, cleanup: 'complete' }) =>
      resolveExit(exit),
  };
}
