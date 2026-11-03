import { configureMcpBearer } from './mcp-auth.ts';
import { authorizeMcpOAuth } from './mcp-oauth.ts';
import { CLI_HELP } from './help.ts';
import { startHost } from '@praxis/client-host';
import { assert } from '@praxis/contracts';
import { parseOptions, validateMcpOptions } from './options.ts';
import { bindCliIdentity } from './login-cli.ts';
import { dataCommand } from './data-command.ts';
import { pluginCommand } from './plugin-command.ts';
import { mcpCommand } from './mcp-command.ts';
import { prepareSession } from './session-setup.ts';
import { CliSession } from './session.ts';
import { userInstructionsCommand } from './user-instructions-command.ts';
import type { CliOptions } from './options.ts';

async function configurationCommand(
  command: string,
  host: Awaited<ReturnType<typeof startHost>>,
  values: CliOptions,
  positionals: string[],
  bearer?: string,
) {
  if (command === 'plugins') await pluginCommand(host, values, positionals);
  else if (command === 'mcp') await mcpCommand(host, positionals, values, bearer);
  else if (command === 'instructions') await userInstructionsCommand(host, values, positionals);
  else if (command === 'config') {
    assert(positionals[1], 'INVALID_COMMAND', '请提供会话 ID：config SESSION_ID。');
    console.log(
      JSON.stringify(
        await host.rpc.request('session/config', { sessionId: positionals[1] }),
        null,
        2,
      ),
    );
  } else return false;
  return true;
}

export async function runCli() {
  const { values, positionals } = parseOptions();
  const command = positionals[0] ?? 'help';
  assert(
    [values.prompt, values.command, values['apply-prompt']].filter(Boolean).length <= 1,
    'INVALID_COMMAND',
    '--prompt、--command 与 --apply-prompt 不能同时使用。',
  );
  if (values.help || command === 'help') {
    console.log(CLI_HELP);
    return;
  }
  assert(
    [
      'doctor',
      'run',
      'sessions',
      'providers',
      'plugins',
      'mcp',
      'data',
      'instructions',
      'config',
    ].includes(command),
    'INVALID_COMMAND',
    '未知命令，使用 --help 查看帮助。',
  );
  const mcpBearer = process.env.PRAXIS_MCP_BEARER;
  delete process.env.PRAXIS_MCP_BEARER;
  validateMcpOptions(values, command);
  if (command === 'data') {
    await dataCommand(values, positionals);
    return;
  }
  const host = await startHost('cli');
  let session: CliSession | undefined;
  try {
    if (command === 'doctor') {
      console.log(JSON.stringify(await host.rpc.request('host/diagnostics'), null, 2));
      return;
    }
    await bindCliIdentity(host, values);
    if (await configurationCommand(command, host, values, positionals, mcpBearer)) return;
    if (command === 'sessions' || command === 'providers') {
      console.log(
        JSON.stringify(
          await host.rpc.request(command === 'sessions' ? 'session/list' : 'provider/list'),
          null,
          2,
        ),
      );
      return;
    }
    if (values['mcp-bearer-server'])
      await configureMcpBearer(host, values['mcp-bearer-server'], mcpBearer, true);
    if (values['mcp-oauth-server'])
      await authorizeMcpOAuth(host, values['mcp-oauth-server'], values, true);
    const sessionId = await prepareSession(host, values);
    session = new CliSession(host, sessionId, values);
    await session.run();
  } finally {
    session?.close();
    await host.close();
  }
}
