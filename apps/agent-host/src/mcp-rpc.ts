import { z } from 'zod';
import type { HostIdentity } from './identity.ts';
import type { RpcRoutes } from './rpc-schema.ts';
import { noArgs } from './rpc-schema.ts';
export function mcpRoutes(identity: HostIdentity): RpcRoutes {
  return {
    'mcp/server-list': async (params: unknown) => {
      const { mcpConfig } = identity.require();
      noArgs.parse(params);
      return mcpConfig!.file.read();
    },
    'mcp/server-upsert': async (params: unknown) => {
      const { mcpConfig } = identity.require();
      const input = z
        .strictObject({
          config: z.unknown(),
          expectedStoreRevision: z.number().int().nonnegative(),
          expectedRevision: z.number().int().positive().nullable(),
        })
        .parse(params);
      return mcpConfig!.upsert(input.config, input.expectedStoreRevision, input.expectedRevision);
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
