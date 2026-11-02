import type { QueryResultRow } from 'pg';

export interface SqlConnection {
  query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

export interface ServerDatabase extends SqlConnection {
  transaction<T>(body: (connection: SqlConnection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
