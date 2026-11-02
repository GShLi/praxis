import { AuthService, scopes } from '@praxis/auth';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { HttpApp } from './http-types.ts';

export function registerAccount(app: HttpApp, auth: AuthService, secure: boolean) {
  app.post('/v1/auth/token', async (c) => c.json(await auth.exchange(c.get('identity'))));
  app.post('/v1/auth/logout', async (c) => {
    await auth.logout(c.get('identity'));
    deleteCookie(c, 'praxis_csrf', { path: '/' });
    deleteCookie(c, 'praxis_session', { path: '/' });
    deleteCookie(c, 'praxis_refresh', { path: '/v1/auth' });
    return c.json({ ok: true });
  });
  app.get('/v1/me', async (c) => {
    const cookie = getCookie(c, 'praxis_csrf');
    const profile = await auth.profile(c.get('identity'), cookie);
    if (profile.csrfToken && profile.csrfToken !== cookie)
      setCookie(c, 'praxis_csrf', profile.csrfToken, {
        secure,
        sameSite: 'Strict',
        path: '/',
        maxAge: 30 * 86400,
      });
    return c.json(profile);
  });
  app.get('/v1/api-keys', async (c) => c.json(await auth.listApiKeys(c.get('identity'))));
  app.post('/v1/api-keys', async (c) => {
    const input = z
      .strictObject({
        name: z.string().min(1).max(100),
        scopes: z.array(z.enum(scopes)).min(1),
        days: z.number().int().min(1).max(365).default(90),
      })
      .parse(await c.req.json());
    return c.json(
      await auth.createApiKey(c.get('identity'), input.name, input.scopes, input.days),
      201,
    );
  });
  app.delete('/v1/api-keys/:id', async (c) => {
    await auth.revokeApiKey(c.get('identity'), c.req.param('id'));
    return c.json({ ok: true });
  });
}
