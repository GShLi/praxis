import { assert } from '@praxis/contracts';
import { setCookie } from 'hono/cookie';
export function webSecurity(origin: string) {
  const secure = origin.startsWith('https:');
  const checkOrigin = (value: string | undefined) =>
    assert(value === origin, 'CSRF_FAILED', '请求来源不匹配。');
  const cookies = (
    c: Parameters<typeof setCookie>[0],
    result: { accessToken: string; refreshToken: string; csrfToken: string },
  ) => {
    setCookie(c, 'praxis_csrf', result.csrfToken, {
      secure,
      sameSite: 'Strict',
      path: '/',
      maxAge: 30 * 86400,
    });
    setCookie(c, 'praxis_session', result.accessToken, {
      httpOnly: true,
      secure,
      sameSite: 'Strict',
      path: '/',
      maxAge: 900,
    });
    setCookie(c, 'praxis_refresh', result.refreshToken, {
      httpOnly: true,
      secure,
      sameSite: 'Strict',
      path: '/v1/auth',
      maxAge: 30 * 86400,
    });
  };
  return { checkOrigin, cookies, secure };
}
