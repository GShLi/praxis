import type { DiagnosticLog } from '@praxis/diagnostics';
import type { HttpApp } from './http-types.ts';

export function registerRequestDiagnostics(
  app: HttpApp,
  diagnostics?: Pick<DiagnosticLog, 'record'>,
) {
  if (!diagnostics) return;
  app.use('*', async (c, next) => {
    const started = performance.now();
    await next();
    diagnostics.record({
      component: 'server',
      kind: 'request',
      phase: c.res.status >= 400 ? 'error' : 'finished',
      httpStatus: c.res.status,
      durationMs: Math.round(performance.now() - started),
    });
  });
}
