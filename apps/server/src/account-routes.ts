import { AuthService, digest, scopes } from '@praxis/auth';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { randomBytes } from 'node:crypto';
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
    const identity = c.get('identity');
    auth.require(identity, 'profile:read');
    let csrfToken: string | undefined;
    if (identity.kind === 'web') {
      csrfToken = getCookie(c, 'praxis_csrf');
      if (!csrfToken || digest(csrfToken) !== identity.csrfHash) {
        csrfToken = randomBytes(32).toString('base64url');
        await auth.database.query('UPDATE auth_sessions SET csrf_hash=$1 WHERE id=$2', [
          digest(csrfToken),
          identity.sessionId,
        ]);
        setCookie(c, 'praxis_csrf', csrfToken, {
          secure,
          sameSite: 'Strict',
          path: '/',
          maxAge: 30 * 86400,
        });
      }
    }
    return c.json({
      id: identity.userId,
      username: identity.username,
      scopes: identity.scopes,
      ...(csrfToken ? { csrfToken } : {}),
    });
  });
  app.get('/v1/api-keys', async (c) => {
    const user = c.get('identity');
    auth.require(user, 'keys:write');
    return c.json(
      (
        await auth.database.query(
          'SELECT id,name,scopes,expires_at,revoked_at,last_used_at FROM api_keys WHERE user_id=$1',
          [user.userId],
        )
      ).rows,
    );
  });
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
    const identity = c.get('identity');
    auth.require(identity, 'keys:write');
    await auth.database.query('UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND user_id=$2', [
      c.req.param('id'),
      identity.userId,
    ]);
    return c.json({ ok: true });
  });
}
