import type { PoolClient, QueryResultRow } from 'pg';
import { Pool } from 'pg';
import type { ServerDatabase, SqlConnection } from './types.ts';

export class PostgresDatabase implements ServerDatabase {
  readonly pool: Pool;
  constructor(url: string) {
    this.pool = new Pool({
      connectionString: url,
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
    });
  }
  query<R extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) {
    return this.pool.query<R>(sql, values);
  }
  async transaction<T>(body: (connection: SqlConnection) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await body(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}
