import { AuthService } from '@praxis/auth';
import { safeError } from '@praxis/contracts';
import { diagnosticCode, type DiagnosticLog } from '@praxis/diagnostics';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import type { HttpApp } from './http-types.ts';
import { registerRequestDiagnostics } from './http-diagnostics.ts';

export function registerMiddleware(
  app: HttpApp,
  auth: AuthService,
  diagnostics?: Pick<DiagnosticLog, 'record'>,
) {
  registerRequestDiagnostics(app, diagnostics);
  app.use('*', secureHeaders());
  app.use(
    '/v1/*',
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (c) =>
        c.json(
          { code: 'BODY_TOO_LARGE', safeMessage: '请求超过大小限制。', retryable: false },
          413,
        ),
    }),
  );
  app.use('/v1/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.onError((error, c) => {
    const safe = safeError(error);
    const code = safe.code;
    diagnostics?.record({
      component: 'server',
      kind: 'request',
      phase: 'error',
      code: diagnosticCode(code),
    });
    const status =
      code === 'UNAUTHENTICATED' || code === 'AUTH_FAILED'
        ? 401
        : code === 'FORBIDDEN' || code === 'CSRF_FAILED'
          ? 403
          : code.endsWith('_NOT_FOUND')
            ? 404
            : code.includes('CONFLICT') || code === 'SESSION_BUSY'
              ? 409
              : code === 'RATE_LIMITED'
                ? 429
                : code === 'INTERNAL_ERROR'
                  ? 500
                  : 400;
    return c.json(safe, status);
  });
  app.get('/health/live', (c) => c.json({ ok: true }));
  app.get('/health/ready', async (c) => {
    await auth.database.query('SELECT 1');
    return c.json({ ok: true });
  });
}
