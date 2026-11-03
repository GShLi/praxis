import { CLI_HELP } from './help.ts';
import { startHost } from '@praxis/client-host';
import { assert } from '@praxis/contracts';
import { parseOptions } from './options.ts';
import { pluginCommand } from './plugin-command.ts';
import { mcpCommand } from './mcp-command.ts';
import { prepareSession } from './session-setup.ts';
import { CliSession } from './session.ts';

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
    ['doctor', 'run', 'sessions', 'providers', 'plugins', 'mcp'].includes(command),
    'INVALID_COMMAND',
    '未知命令，使用 --help 查看帮助。',
  );
  const host = await startHost('cli');
  let session: CliSession | undefined;
  try {
    if (command === 'doctor') {
      console.log(JSON.stringify(await host.rpc.request('host/diagnostics'), null, 2));
      return;
    }
    const serverUrl = values.server ?? process.env.PRAXIS_SERVER_URL ?? 'http://127.0.0.1:4310';
    const praxisApiKey = process.env.PRAXIS_API_KEY;
    assert(
      praxisApiKey,
      'PRAXIS_KEY_REQUIRED',
      '请先设置 PRAXIS_API_KEY；不要将密钥写在命令行参数中。',
    );
    await host.rpc.request('auth/bind', {
      serverUrl,
      praxisApiKey,
      ...(values.provider ? { providerId: values.provider } : {}),
      interactive: Boolean(
        process.stdin.isTTY && !values.prompt && !values.command && !values['apply-prompt'],
      ),
    });
    if (command === 'plugins') {
      await pluginCommand(host, values, positionals);
      return;
    }
    if (command === 'mcp') {
      await mcpCommand(host, positionals, values);
      return;
    }
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
    const sessionId = await prepareSession(host, values);
    session = new CliSession(host, sessionId, values);
    await session.run();
  } finally {
    session?.close();
    await host.close();
  }
}
