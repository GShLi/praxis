import { assert } from '@praxis/contracts';
import type { StoreAccess } from './store-access.ts';
import type { Row } from './types.ts';
export class MaintenanceRepository {
  constructor(private store: Pick<StoreAccess, 'transaction' | 'db'>) {}
  startMaintenance(id: string, owner: string, serverId: string, configRevision: number) {
    this.store.transaction(() => {
      this.store.db
        .prepare(
          "DELETE FROM maintenance_operations WHERE id IN (SELECT id FROM maintenance_operations WHERE state<>'running' ORDER BY rowid DESC LIMIT -1 OFFSET 999)",
        )
        .run();
      this.store.db.prepare('INSERT INTO maintenance_operations VALUES(?,?,?,?)').run(
        id,
        owner,
        'running',
        JSON.stringify({
          operation: 'mcp/test',
          serverId,
          configRevision,
          startedAt: new Date().toISOString(),
        }),
      );
    });
  }
  finishMaintenance(id: string, state: 'succeeded' | 'failed' | 'cancelled', code?: string) {
    const row = this.store.db
      .prepare('SELECT document FROM maintenance_operations WHERE id=? AND state=?')
      .get(id, 'running') as Row | undefined;
    assert(row, 'MCP_OPERATION_NOT_FOUND', 'MCP 维护操作已结束或不存在。');
    const document = {
      ...JSON.parse(String(row.document)),
      endedAt: new Date().toISOString(),
      ...(code ? { code } : {}),
    };
    this.store.db
      .prepare('UPDATE maintenance_operations SET state=?,document=? WHERE id=?')
      .run(state, JSON.stringify(document), id);
  }
}
