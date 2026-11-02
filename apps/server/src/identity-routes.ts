import { AuthService, digest } from '@praxis/auth';
import { assert } from '@praxis/contracts';
import { getCookie } from 'hono/cookie';
import type { HttpApp } from './http-types.ts';
import { webSecurity } from './web-security.ts';

export function registerIdentity(
  app: HttpApp,
  auth: AuthService,
  security: ReturnType<typeof webSecurity>,
) {
  const { checkOrigin } = security;
  app.use('/v1/*', async (c, next) => {
    const authorization = c.req.header('authorization');
    const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    const token = bearer ?? getCookie(c, 'praxis_session');
    assert(token, 'UNAUTHENTICATED', '请登录 Praxis。');
    const identity = await auth.authenticate(token);
    if (identity.kind === 'web' && !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      checkOrigin(c.req.header('origin'));
      const csrf = c.req.header('x-csrf-token');
      assert(
        csrf && digest(csrf) === identity.csrfHash,
        'CSRF_FAILED',
        '页面安全令牌已失效，请刷新。',
      );
    }
    c.set('identity', identity);
    await next();
  });
}
