import { parseArgs } from 'node:util';
export function parseOptions() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      server: { type: 'string' },
      workspace: { type: 'string' },
      provider: { type: 'string' },
      resume: { type: 'string' },
      prompt: { type: 'string' },
      digest: { type: 'string' },
      json: { type: 'boolean' },
      'read-only': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  return { values, positionals };
}
export type CliOptions = ReturnType<typeof parseOptions>['values'];
