import type { startHost } from '@praxis/client-host';
import { assert } from '@praxis/contracts';
import type { CliOptions } from './options.ts';

export async function bindCliIdentity(
  host: Awaited<ReturnType<typeof startHost>>,
  values: CliOptions,
) {
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
}
