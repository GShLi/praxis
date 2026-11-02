import { assert } from '@praxis/contracts';
import { z } from 'zod';
import type { HostIdentity } from './identity.ts';
import type { RpcRoutes } from './rpc-schema.ts';
import { noArgs } from './rpc-schema.ts';
export function pluginsRoutes(
  identity: HostIdentity,
  clientKind: () => 'cli' | 'desktop',
): RpcRoutes {
  return {
    'plugin/list': async (params: unknown) => {
      const { auth, store, runtime, mcpConfig, mcpMaintenance, pluginInstaller, owner } =
        identity.require();
      noArgs.parse(params);
      return {
        ...(await pluginInstaller!.records.read()),
        restartRequired: identity.pluginsChanged,
        failures: identity.pluginFailures,
      };
    },
    'plugin/inspect': async (params: unknown) => {
      const { auth, store, runtime, mcpConfig, mcpMaintenance, pluginInstaller, owner } =
        identity.require();
      const input = z.strictObject({ source: z.string().max(4096) }).parse(params);
      return pluginInstaller!.inspect(input.source);
    },
    'plugin/install': async (params: unknown) => {
      const { auth, store, runtime, mcpConfig, mcpMaintenance, pluginInstaller, owner } =
        identity.require();
      const input = z
        .strictObject({
          source: z.string().max(4096),
          expectedDigest: z.string().regex(/^[a-f0-9]{64}$/),
          expectedRevision: z.number().int().nonnegative(),
        })
        .parse(params);
      assert(!runtime.busy, 'SESSION_BUSY', '安装插件前请停止活动任务。');
      const result = await pluginInstaller!.install(
        input.source,
        input.expectedDigest,
        input.expectedRevision,
      );
      identity.pluginsChanged = true;
      return { ...result, restartRequired: true };
    },
    'plugin/set-enabled': async (params: unknown) => {
      const { auth, store, runtime, mcpConfig, mcpMaintenance, pluginInstaller, owner } =
        identity.require();
      const input = z
        .strictObject({
          id: z.string().max(100),
          enabled: z.boolean(),
          expectedRevision: z.number().int().nonnegative(),
        })
        .parse(params);
      assert(!runtime.busy, 'SESSION_BUSY', '更改插件前请停止活动任务。');
      const result = await pluginInstaller!.setEnabled(
        input.id,
        input.enabled,
        input.expectedRevision,
      );
      identity.pluginsChanged = true;
      return { ...result, restartRequired: true };
    },
  };
}
