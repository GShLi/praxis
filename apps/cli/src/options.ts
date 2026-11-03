import { parseArgs } from 'node:util';
import { assert } from '@praxis/contracts';
export function parseOptions() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      server: { type: 'string' },
      client: { type: 'string' },
      confirm: { type: 'string' },
      revision: { type: 'string' },
      workspace: { type: 'string' },
      provider: { type: 'string' },
      resume: { type: 'string' },
      prompt: { type: 'string' },
      command: { type: 'string' },
      'apply-prompt': { type: 'string' },
      'content-hash': { type: 'string' },
      'mcp-bearer-server': { type: 'string' },
      'mcp-oauth-server': { type: 'string' },
      issuer: { type: 'string' },
      'client-id': { type: 'string' },
      'redirect-uri': { type: 'string' },
      scopes: { type: 'string' },
      'allow-private-issuer': { type: 'boolean' },
      'no-browser': { type: 'boolean' },
      arguments: { type: 'string' },
      digest: { type: 'string' },
      json: { type: 'boolean' },
      'read-only': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  return { values, positionals };
}
export type CliOptions = ReturnType<typeof parseOptions>['values'];
export function validateMcpOptions(values: CliOptions, command: string) {
  assert(
    !(values['mcp-bearer-server'] && values['mcp-oauth-server']),
    'INVALID_ARGUMENT',
    '本次运行请选择一种 MCP 认证方式。',
  );
  assert(
    !(values['mcp-oauth-server'] || values['mcp-bearer-server']) || command === 'run',
    'INVALID_ARGUMENT',
    '--mcp-oauth-server 和 --mcp-bearer-server 仅用于 run。',
  );
}
