import { assert } from '@praxis/contracts';
import type { PostgresDatabase } from '@praxis/storage-server';

/** A dedicated connection holds the instance lock until all runtime resources stop. */
export async function acquireServerLease(database: PostgresDatabase, stop: () => void) {
  const lease = await database.pool.connect();
  lease.on('error', stop);
  try {
    const result = await lease.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(707261786974) AS acquired',
    );
    assert(result.rows[0]?.acquired, 'SERVER_ALREADY_RUNNING', '数据库已有 Praxis 服务实例。');
  } catch (error) {
    lease.off('error', stop);
    lease.release();
    throw error;
  }
  let closed = false;
  return {
    async close() {
      if (closed) return;
      closed = true;
      lease.off('error', stop);
      try {
        await lease.query('SELECT pg_advisory_unlock(707261786974)');
      } finally {
        lease.release();
      }
    },
  };
}
