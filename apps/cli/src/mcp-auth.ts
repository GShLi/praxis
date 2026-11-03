import { enableMcpConnection } from './mcp-enable.ts';
import { authorizeMcpOAuth } from './mcp-oauth.ts';
import type { CliOptions } from './options.ts';
import type { startHost } from '@praxis/client-host';
import { assert } from '@praxis/contracts';
type Host = Awaited<ReturnType<typeof startHost>>;
export async function mcpCredentialCommand(
  host: Host,
  action: string,
  target: string | undefined,
  values: CliOptions,
  bearer?: string,
) {
  if (!['auth', 'clear-auth', 'oauth'].includes(action)) return false;
  assert(target, 'INVALID_ARGUMENT', '需要服务器 ID。');
  if (action === 'oauth') await authorizeMcpOAuth(host, target, values);
  else
    console.log(
      JSON.stringify(
        action === 'auth'
          ? await configureMcpBearer(host, target, bearer)
          : await clearMcpCredential(host, target),
        null,
        2,
      ),
    );
  return true;
}

export async function configureMcpBearer(
  host: Host,
  serverId: string,
  token: string | undefined,
  enable = false,
) {
  assert(
    token,
    'MCP_CREDENTIAL_REQUIRED',
    '请通过 PRAXIS_MCP_BEARER 提供此服务器专用的 Token；不要将 Token 写入命令行参数。',
  );
  const state = await host.rpc.request<{
    revision: number;
    value: Array<{ id: string; revision: number }>;
  }>('mcp/server-list');
  const config = state.value.find((c) => c.id === serverId);
  assert(config, 'MCP_NOT_FOUND', '请先导入此服务器配置。');
  await host.rpc.request<typeof state>('mcp/credential-set', {
    serverId,
    expectedStoreRevision: state.revision,
    expectedRevision: config.revision,
    token,
  });
  if (enable) await enableMcpConnection(host, serverId);
  return host.rpc.request('mcp/server-list');
}

export async function clearMcpCredential(host: Host, serverId: string) {
  const state = await host.rpc.request<{
    revision: number;
    value: Array<{ id: string; revision: number }>;
  }>('mcp/server-list');
  const config = state.value.find((c) => c.id === serverId);
  assert(config, 'MCP_NOT_FOUND', '需要已保存的服务器 ID。');
  await host.rpc.request('mcp/credential-clear', {
    serverId,
    expectedStoreRevision: state.revision,
    expectedRevision: config.revision,
  });
  return host.rpc.request('mcp/server-list');
}
