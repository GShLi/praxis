import { assert } from '../../contracts/src/index.ts';
import { validateConfig } from '../../mcp-core/src/index.ts';
import type { McpConfig } from '../../mcp-core/src/index.ts';
import { fixedEndpointHttp } from '../../transport/src/http.ts';
import type { HttpDependencies } from '../../transport/src/http.ts';
export { isPublicAddress } from '../../transport/src/http.ts';
export type { HttpDependencies } from '../../transport/src/http.ts';

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
