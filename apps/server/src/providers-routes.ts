import { AuthService, providerInputSchema } from '@praxis/auth';
import { assert, idSchema } from '@praxis/contracts';
import { discoverModels } from '@praxis/model-core/catalog';
import { modelDiscoverySchema } from '@praxis/model-core/provider';
import { z } from 'zod';
import type { HttpApp } from './http-types.ts';

export function registerProviders(app: HttpApp, auth: AuthService, catalog: typeof discoverModels) {
  app.get('/v1/providers', async (c) => c.json(await auth.listProviders(c.get('identity'))));
  app.post('/v1/providers/discover-models', async (c) => {
    const input = modelDiscoverySchema.parse(await c.req.json());
    const credentials = await auth.providerDiscoveryCredentials(c.get('identity'), input);
    return c.json(await catalog(credentials, c.req.raw.signal));
  });
  app.post('/v1/client/provider-discovery', async (c) => {
    const input = modelDiscoverySchema.parse(await c.req.json());
    return c.json(await auth.providerDiscoveryCredentials(c.get('identity'), input, true));
  });
  app.post('/v1/providers', async (c) => {
    const input = z
      .strictObject({ config: providerInputSchema, apiKey: z.string().min(1).max(4096) })
      .parse(await c.req.json());
    return c.json(await auth.saveProvider(c.get('identity'), input.config, input.apiKey), 201);
  });
  app.put('/v1/providers/:id', async (c) => {
    const input = z
      .strictObject({
        config: providerInputSchema,
        apiKey: z.string().min(1).max(4096).optional(),
        expectedRevision: z.number().int().min(1),
      })
      .parse(await c.req.json());
    return c.json(
      await auth.saveProvider(
        c.get('identity'),
        input.config,
        input.apiKey,
        c.req.param('id'),
        input.expectedRevision,
      ),
    );
  });
  app.delete('/v1/providers/:id', async (c) => {
    const identity = c.get('identity');
    auth.require(identity, 'providers:write');
    const input = z
      .strictObject({ expectedRevision: z.number().int().min(1) })
      .parse(await c.req.json());
    const result = await auth.database.query(
      'DELETE FROM provider_configs WHERE id=$1 AND user_id=$2 AND revision=$3',
      [c.req.param('id'), identity.userId, input.expectedRevision],
    );
    assert(result.rowCount, 'CONFIG_CONFLICT', '配置不存在或已变化。');
    return c.json({ ok: true });
  });
  app.post('/v1/client/provider-uses', async (c) => {
    const input = z.strictObject({ providerId: idSchema }).parse(await c.req.json());
    const identity = c.get('identity');
    assert(identity.kind !== 'web', 'FORBIDDEN', 'Web 页面不能读取厂商 Key。');
    return c.json(await auth.beginUse(identity, input.providerId, true));
  });
}
