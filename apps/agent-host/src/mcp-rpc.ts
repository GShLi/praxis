import { assert } from '@praxis/contracts';
import { z } from 'zod';
import type { HostIdentity } from './identity.ts';
import type { RpcRoutes } from './rpc-schema.ts';
import { noArgs } from './rpc-schema.ts';
export function mcpRoutes(identity: HostIdentity): RpcRoutes {
  const credentials = () => {
    identity.require();
    assert(identity.mcpCredentials, 'MCP_AUTH_REQUIRED', 'MCP 凭据服务未初始化。');
    return identity.mcpCredentials;
  };
  const credentialInput = z.strictObject({
    serverId: z.uuid(),
    expectedStoreRevision: z.number().int().nonnegative(),
    expectedRevision: z.number().int().positive(),
  });
  return {
    'mcp/credential-set': async (params) => {
      const input = credentialInput.extend({ token: z.string().min(1).max(8192) }).parse(params);
      return credentials().setBearer(
        input.serverId,
        input.expectedStoreRevision,
        input.expectedRevision,
        input.token,
      );
    },
    'mcp/credential-clear': async (params) => {
      const input = credentialInput.parse(params);
      return credentials().clear(
        input.serverId,
        input.expectedStoreRevision,
        input.expectedRevision,
      );
    },
    'mcp/server-list': async (params: unknown) => {
      const { mcpConfig } = identity.require();
      noArgs.parse(params);
      const state = await mcpConfig.file.read();
      return {
        ...state,
        value: state.value.map((config) => ({
          ...config,
          credential: credentials().status(config),
        })),
      };
    },
    'mcp/server-upsert': async (params: unknown) => {
      const input = z
        .strictObject({
          config: z.unknown(),
          expectedStoreRevision: z.number().int().nonnegative(),
          expectedRevision: z.number().int().positive().nullable(),
        })
        .parse(params);
      return credentials().saveConfig(
        input.config,
        input.expectedStoreRevision,
        input.expectedRevision,
      );
    },
    'mcp/server-delete': async (params) => {
      const input = credentialInput.parse(params);
      return credentials().deleteConfig(
        input.serverId,
        input.expectedStoreRevision,
        input.expectedRevision,
      );
    },
    'mcp/server-disable': async (params: unknown) => {
      const { mcpConfig } = identity.require();
      const input = z
        .strictObject({ serverId: z.uuid(), expectedStoreRevision: z.number().int().nonnegative() })
        .parse(params);
      return mcpConfig!.disable(input.serverId, input.expectedStoreRevision);
    },
    'mcp/test': async (params: unknown) => {
      const { mcpMaintenance } = identity.require();
      const input = z
        .strictObject({ serverId: z.uuid(), expectedRevision: z.number().int().positive() })
        .parse(params);
      return mcpMaintenance!.test(input.serverId, input.expectedRevision);
    },
    'mcp/server-enable': async (params: unknown) => {
      const { mcpMaintenance } = identity.require();
      const input = z
        .strictObject({
          serverId: z.uuid(),
          expectedStoreRevision: z.number().int().nonnegative(),
          expectedRevision: z.number().int().positive(),
        })
        .parse(params);
      return mcpMaintenance.enable(
        input.serverId,
        input.expectedStoreRevision,
        input.expectedRevision,
      );
    },
  };
}
