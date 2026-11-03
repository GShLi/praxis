import type { startHost } from '@praxis/client-host';
import { assert } from '@praxis/contracts';

export async function enableMcpConnection(
  host: Awaited<ReturnType<typeof startHost>>,
  serverId: string,
) {
  const state = await host.rpc.request<{
    revision: number;
    value: Array<{ id: string; revision: number }>;
  }>('mcp/server-list');
  const config = state.value.find((c) => c.id === serverId);
  assert(config, 'MCP_NOT_FOUND', '服务器配置不可用。');
  await host.rpc.request('mcp/test', { serverId, expectedRevision: config.revision });
  return host.rpc.request('mcp/server-enable', {
    serverId,
    expectedStoreRevision: state.revision,
    expectedRevision: config.revision,
  });
}
