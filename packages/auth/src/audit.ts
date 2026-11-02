import type { SqlConnection } from '@praxis/storage-server';
export function recordAudit(
  sql: SqlConnection,
  actor: string,
  operation: string,
  resource: string,
  outcome = 'success',
) {
  return sql.query(
    'INSERT INTO audit_events(actor,operation,resource_id,outcome) VALUES($1,$2,$3,$4)',
    [actor, operation, resource, outcome],
  );
}
