import { providerInputSchema } from '@praxis/auth';
import { idSchema } from '@praxis/contracts';
import { modelDiscoverySchema } from '@praxis/model-core/provider';
import { z } from 'zod';
import type { HostIdentity } from './identity.ts';
import type { RpcRoutes } from './rpc-schema.ts';
import { noArgs } from './rpc-schema.ts';
export function providersRoutes(
  identity: HostIdentity,
  clientKind: () => 'cli' | 'desktop',
): RpcRoutes {
  return {
    'auth/me': async (params: unknown) => {
      const { auth, store, runtime, mcpConfig, mcpMaintenance, pluginInstaller, owner } =
        identity.require();
      noArgs.parse(params);
      return auth.profile(AbortSignal.timeout(15000));
    },
    'provider/delete': async (params: unknown) => {
      const { auth, store, runtime, mcpConfig, mcpMaintenance, pluginInstaller, owner } =
        identity.require();
      const input = z
        .strictObject({ id: idSchema, expectedRevision: z.number().int().positive() })
        .parse(params);
      return auth.deleteProvider(input.id, input.expectedRevision, AbortSignal.timeout(15000));
    },
    'provider/models': async (params: unknown) => {
      const { auth, store, runtime, mcpConfig, mcpMaintenance, pluginInstaller, owner } =
        identity.require();
      const input = modelDiscoverySchema.parse(params);
      return auth.discoverModels(
        input,
        AbortSignal.any([identity.discoveryScope.signal, AbortSignal.timeout(25_000)]),
      );
    },
    'provider/list': async (params: unknown) => {
      const { auth, store, runtime, mcpConfig, mcpMaintenance, pluginInstaller, owner } =
        identity.require();
      noArgs.parse(params);
      return auth.providers(AbortSignal.timeout(15_000));
    },
    'provider/select': async (params: unknown) => {
      const { auth, store, runtime, mcpConfig, mcpMaintenance, pluginInstaller, owner } =
        identity.require();
      const input = z.strictObject({ providerId: idSchema }).parse(params);
      identity.selectedProvider = input.providerId;
      return { ok: true };
    },
    'provider/save': async (params: unknown) => {
      const { auth, store, runtime, mcpConfig, mcpMaintenance, pluginInstaller, owner } =
        identity.require();
      const input = z
        .strictObject({
          config: providerInputSchema,
          apiKey: z.string().min(1).max(4096).optional(),
          id: idSchema.optional(),
          expectedRevision: z.number().int().positive().optional(),
        })
        .parse(params);
      return auth.saveProvider(
        {
          config: input.config,
          ...(input.apiKey ? { apiKey: input.apiKey } : {}),
          ...(input.id ? { id: input.id, expectedRevision: input.expectedRevision! } : {}),
        },
        AbortSignal.timeout(15_000),
      );
    },
  };
}
