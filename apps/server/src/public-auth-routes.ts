import { AuthService } from '@praxis/auth';
import { assert } from '@praxis/contracts';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import type { HttpApp } from './http-types.ts';
import { webSecurity } from './web-security.ts';
const loginSchema = z.strictObject({
  username: z.string().min(1).max(100),
  password: z.string().max(1024),
  kind: z.enum(['web', 'client']).default('web'),
});

export function registerPublicAuth(
  app: HttpApp,
  auth: AuthService,
  security: ReturnType<typeof webSecurity>,
) {
  const rate = new Map<string, { count: number; until: number }>();
  const { checkOrigin, cookies } = security;
  app.post('/v1/auth/login', async (c) => {
    const input = loginSchema.parse(await c.req.json());
    if (input.kind === 'web') checkOrigin(c.req.header('origin'));
    const key = input.username.toLowerCase();
    if (rate.size >= 5000) {
      for (const [k, v] of rate) if (v.until < Date.now()) rate.delete(k);
      assert(rate.has(key) || rate.size < 5000, 'RATE_LIMITED', '登录服务繁忙，请稍后重试。');
    }
    const previous = rate.get(key);
    const now = Date.now();
    const bucket = previous && previous.until > now ? previous : { count: 0, until: now + 60_000 };
    assert(++bucket.count <= 5, 'RATE_LIMITED', '尝试过于频繁，请稍后再试。');
    rate.set(key, bucket);
    if (rate.size > 5000) for (const [k, v] of rate) if (v.until < now) rate.delete(k);
    const result = await auth.login(input.username, input.password, input.kind);
    if (input.kind === 'web') {
      cookies(c, result);
      return c.json({ expiresAt: result.expiresAt, csrfToken: result.csrfToken });
    }
    return c.json(result);
  });
  app.post('/v1/auth/refresh', async (c) => {
    const webToken = getCookie(c, 'praxis_refresh');
    const body = webToken
      ? undefined
      : z
          .strictObject({ refreshToken: z.string().min(20).max(1024).optional() })
          .parse(await c.req.json());
    // A fresh browser sends {} without an HttpOnly refresh cookie: it needs login.
    const token = webToken ?? body?.refreshToken;
    assert(token, 'UNAUTHENTICATED', '请登录 Praxis。');
    if (webToken) checkOrigin(c.req.header('origin'));
    const result = await auth.refresh(token, Boolean(webToken));
    if (webToken) {
      cookies(c, result);
      return c.json({ expiresAt: result.expiresAt, csrfToken: result.csrfToken });
    }
    return c.json(result);
  });
}
