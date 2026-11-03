import type { startHost } from '@praxis/client-host';
import { assert } from '@praxis/contracts';
type Host = Awaited<ReturnType<typeof startHost>>;

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
  const saved = await host.rpc.request<typeof state>('mcp/credential-set', {
    serverId,
    expectedStoreRevision: state.revision,
    expectedRevision: config.revision,
    token,
  });
  const current = saved.value.find((c) => c.id === serverId);
  assert(current, 'MCP_NOT_FOUND', '服务器配置不可用。');
  if (enable) {
    await host.rpc.request('mcp/test', { serverId, expectedRevision: current.revision });
    await host.rpc.request('mcp/server-enable', {
      serverId,
      expectedStoreRevision: saved.revision,
      expectedRevision: current.revision,
    });
  }
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
