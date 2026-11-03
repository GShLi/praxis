import { baseData } from '@praxis/config/paths';
import { createHash } from 'node:crypto';
import path from 'node:path';

export function serverDiagnosticDirectory(origin: string) {
  return (
    process.env.PRAXIS_SERVER_LOG_DIR ??
    path.join(baseData, 'server', createHash('sha256').update(origin).digest('hex'), 'diagnostics')
  );
}
