import { enableMcpConnection } from './mcp-enable.ts';
import type { startHost } from '@praxis/client-host';
import { assert, type McpOAuthStarted, type McpOAuthStatus } from '@praxis/contracts';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { CliOptions } from './options.ts';
type Host = Awaited<ReturnType<typeof startHost>>;

async function openBrowser(url: string) {
  assert(
    ['https:', 'http:'].includes(new URL(url).protocol),
    'MCP_OAUTH_ENDPOINT',
    '浏览器授权地址无效。',
  );
  const command =
    process.platform === 'darwin'
      ? '/usr/bin/open'
      : process.platform === 'win32'
        ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'rundll32.exe')
        : '/usr/bin/xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
      timeout: 10000,
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('browser unavailable')),
    );
  });
}

export async function authorizeMcpOAuth(
  host: Host,
  serverId: string,
  values: CliOptions,
  enable = false,
) {
  assert(
    values.issuer && values['client-id'] && values['redirect-uri'],
    'INVALID_ARGUMENT',
    'OAuth 需要 --issuer、--client-id 和已注册的 --redirect-uri；不会自动注册客户端。',
  );
  assert(
    process.stdin.isTTY || values['no-browser'],
    'MCP_OAUTH_INTERACTIVE',
    '此环境没有交互终端。请使用本机终端，或明确指定 --no-browser 并在同一机器打开输出的链接。',
  );
  const state = await host.rpc.request<{
    revision: number;
    value: Array<{ id: string; revision: number }>;
  }>('mcp/server-list');
  const config = state.value.find((c) => c.id === serverId);
  assert(config, 'MCP_NOT_FOUND', '请先导入 MCP 服务器配置。');
  const started = await host.rpc.request<McpOAuthStarted>('mcp/oauth-start', {
    serverId,
    expectedStoreRevision: state.revision,
    expectedRevision: config.revision,
    issuer: values.issuer,
    clientId: values['client-id'],
    redirectUri: values['redirect-uri'],
    scopes: (values.scopes ?? '').split(/\s+/).filter(Boolean),
    allowPrivateIssuer: Boolean(values['allow-private-issuer']),
  });
  const scope = new AbortController();
  const cancel = () => scope.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    console.log(`请在本机浏览器完成授权（5 分钟内有效）：\n${started.authorizationUrl}`);
    if (!values['no-browser']) {
      try {
        await openBrowser(started.authorizationUrl);
      } catch {
        console.error('无法打开默认浏览器，请手动打开上面的链接。');
      }
    }
    await waitForAuthorization(host, started, scope.signal);
    if (enable) await enableMcpConnection(host, serverId);
    console.log('OAuth 授权已保存。系统存储不可用时仅本次前台运行有效。');
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
    await host.rpc.request('mcp/oauth-cancel', { id: started.id });
  }
}

async function waitForAuthorization(host: Host, started: McpOAuthStarted, signal: AbortSignal) {
  while (Date.now() <= started.expiresAt + 15000) {
    signal.throwIfAborted();
    const state = await host.rpc.request<McpOAuthStatus>('mcp/oauth-status', { id: started.id });
    if (state.status === 'succeeded') return;
    assert(
      state.status === 'waiting' || state.status === 'exchanging',
      state.error?.code ?? 'MCP_OAUTH_FAILED',
      state.error?.safeMessage ?? '授权未完成。',
    );
    await delay(500, undefined, { signal });
  }
  assert(false, 'MCP_OAUTH_CANCELLED', '授权已超时。');
}
