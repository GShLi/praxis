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
  if (values.help || command === 'help') {
    console.log(
      '知行 Praxis\n\npnpm cli doctor\npnpm cli run --workspace /path/to/project [--prompt "任务"] [--resume SESSION_ID]\npnpm cli sessions\npnpm cli providers\npnpm cli plugins [list|inspect PATH|install PATH --digest SHA256|enable ID|disable ID]\npnpm cli mcp [list|import FILE|test ID|enable ID|disable ID]\n\n配置 PRAXIS_SERVER_URL 和 PRAXIS_API_KEY；厂商 Key 在统一模型设置中填写。\n交互命令：/cancel、/steer 内容、/queue 内容、/exit。Ctrl-C 请求取消，再按一次退出。',
    );
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
      interactive: Boolean(process.stdin.isTTY && !values.prompt),
    });
    if (command === 'plugins') {
      await pluginCommand(host, values, positionals);
      return;
    }
    if (command === 'mcp') {
      await mcpCommand(host, positionals);
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
