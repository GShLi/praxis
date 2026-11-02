import { serveStatic } from '@hono/node-server/serve-static';
import type { HttpApp } from './http-types.ts';
export function registerWebAssets(app: HttpApp, webRoot?: string) {
  if (webRoot) {
    app.get('/v1/*', (c) => c.json({ code: 'NOT_FOUND', safeMessage: '接口不存在。' }, 404));
    app.use('*', async (c, next) => {
      c.header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      );
      await next();
    });
    app.get('*', serveStatic({ root: webRoot }));
    app.get('*', serveStatic({ path: `${webRoot}/index.html` }));
  }
}
