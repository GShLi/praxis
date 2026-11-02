import { PraxisError } from '@praxis/contracts';
import { z } from 'zod';
import type { HostIdentity } from './identity.ts';
import type { RpcRoutes } from './rpc-schema.ts';
import { noArgs } from './rpc-schema.ts';
export function mcpRoutes(identity: HostIdentity, clientKind: () => 'cli' | 'desktop'): RpcRoutes {
  return {
    'mcp/server-list': async (params: unknown) => {
      const { auth, store, runtime, mcpConfig, mcpMaintenance, pluginInstaller, owner } =
        identity.require();
      noArgs.parse(params);
      return mcpConfig!.file.read();
    },
    'mcp/server-upsert': async (params: unknown) => {
      const { auth, store, runtime, mcpConfig, mcpMaintenance, pluginInstaller, owner } =
        identity.require();
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
      const { auth, store, runtime, mcpConfig, mcpMaintenance, pluginInstaller, owner } =
        identity.require();
      const input = z
        .strictObject({ serverId: z.uuid(), expectedStoreRevision: z.number().int().nonnegative() })
        .parse(params);
      return mcpConfig!.disable(input.serverId, input.expectedStoreRevision);
    },
    'mcp/test': async (params: unknown) => {
      const { auth, store, runtime, mcpConfig, mcpMaintenance, pluginInstaller, owner } =
        identity.require();
      const input = z
        .strictObject({ serverId: z.uuid(), expectedRevision: z.number().int().positive() })
        .parse(params);
      return mcpMaintenance!.test(input.serverId, input.expectedRevision);
    },
    'mcp/server-enable': async (params: unknown) => {
      const { auth, store, runtime, mcpConfig, mcpMaintenance, pluginInstaller, owner } =
        identity.require();
      z.strictObject({ serverId: z.uuid() }).parse(params);
      throw new PraxisError(
        'MCP_TRANSPORT_UNAVAILABLE',
        'MCP 工具审批与执行集成尚未完成；当前可检查远程连接，不能启用 Agent 工具。',
      );
    },
  };
}
