import { assert } from '@praxis/contracts';
import type { McpConfig } from '@praxis/mcp-core';
import { validateConfig } from '@praxis/mcp-core';
import type { HttpDependencies } from '@praxis/transport/http';
import { fixedEndpointHttp } from '@praxis/transport/http';
export { isPublicAddress } from '@praxis/transport/http';
export type { HttpDependencies } from '@praxis/transport/http';

/** MCP uses the shared fixed-endpoint transport with its explicit private-destination policy. */
export function controlledHttp(
  config: McpConfig,
  signal: AbortSignal,
  dependencies?: HttpDependencies,
) {
  const transport = validateConfig(config).transport;
  assert(transport.type === 'streamable-http', 'MCP_TRANSPORT_INVALID', '需要 HTTP 服务器配置。');
  return fixedEndpointHttp(
    {
      endpoint: transport.endpoint,
      allowPrivateDestination: transport.allowPrivateDestination,
      errorPrefix: 'MCP',
      label: 'MCP ',
    },
    signal,
    dependencies,
  );
}
