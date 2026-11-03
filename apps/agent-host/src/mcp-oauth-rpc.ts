import { assert, mcpOAuthStartSchema } from '@praxis/contracts';
import { z } from 'zod';
import type { HostIdentity } from './identity.ts';
import type { RpcRoutes } from './rpc-schema.ts';

export function mcpOAuthRoutes(identity: HostIdentity): RpcRoutes {
  const oauth = () => {
    identity.require();
    assert(identity.mcpCredentials, 'MCP_AUTH_REQUIRED', 'MCP 凭据服务尚未初始化。');
    return identity.mcpCredentials.oauth;
  };
  const reference = z.strictObject({ id: z.uuid() });
  return {
    'mcp/oauth-start': (params) => oauth().start(mcpOAuthStartSchema.parse(params)),
    'mcp/oauth-status': (params) => oauth().status(reference.parse(params).id),
    'mcp/oauth-cancel': (params) => oauth().cancel(reference.parse(params).id),
  };
}
