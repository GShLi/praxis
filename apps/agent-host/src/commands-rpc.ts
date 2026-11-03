import { assert, userCommandSchema } from '@praxis/contracts';
import type { HostIdentity } from './identity.ts';
import type { RpcRoutes } from './rpc-schema.ts';
import { z } from 'zod';

export function commandsRoutes(identity: HostIdentity): RpcRoutes {
  return {
    'plugin/commands': (params) => {
      identity.require();
      const { kind } = z.strictObject({ kind: z.enum(['chat', 'agent']) }).parse(params);
      return (identity.pluginHosts?.[kind].snapshot() ?? []).flatMap((plugin) =>
        [...plugin.commands].map(([name, command]) => ({
          pluginId: plugin.manifest.id,
          version: plugin.manifest.version,
          name,
          parameters: command.parameters,
        })),
      );
    },
    'plugin/run-command': (params) => {
      const { runtime, owner } = identity.require();
      assert(
        !identity.pluginsChanged,
        'PLUGIN_RESTART_REQUIRED',
        '插件配置已变化，请重新连接后执行命令。',
      );
      return runtime.command(owner, userCommandSchema.parse(params));
    },
  };
}
