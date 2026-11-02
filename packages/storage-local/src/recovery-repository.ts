import type { Session } from '@praxis/contracts';
import { uuid } from './identity.ts';
import type { StoreAccess } from './store-access.ts';
import type { Row } from './types.ts';
import { recoverMcpOperations } from './mcp-recovery.ts';
export class RecoveryRepository {
  constructor(
    private store: Pick<
      StoreAccess,
      | 'transaction'
      | 'get'
      | 'context'
      | 'inputs'
      | 'db'
      | 'update'
      | 'append'
      | 'messages'
      | 'message'
      | 'suspend'
    >,
  ) {}
  checkpoint(id: string) {
    this.store.transaction(() => {
      const session = this.store.get(id);
      const state = {
        schemaVersion: 1,
        throughSeq: session.latestSeq,
        session,
        context: this.store.context(id),
        suspended: this.store.inputs(id, 'suspended'),
      };
      this.store.db
        .prepare('INSERT OR REPLACE INTO checkpoints VALUES(?,?,?)')
        .run(id, session.latestSeq, JSON.stringify(state));
    });
  }
  recover() {
    this.store.db
      .prepare("UPDATE maintenance_operations SET state='interrupted' WHERE state='running'")
      .run();
    const sessions = (this.store.db.prepare('SELECT document FROM sessions').all() as Row[]).map(
      (r) => JSON.parse(String(r.document)) as Session,
    );
    for (const s of sessions)
      this.store.transaction(() => {
        if (['running', 'waiting_input', 'waiting_approval', 'cancelling'].includes(s.status)) {
          this.store.update(s.id, { status: 'interrupted' });
          this.store.append(s.id, 'turn/interrupted', {
            reason: 'host_restart',
            effects: 'inspect_unfinished_tools',
            approvalsInvalidated: true,
          });
          recoverMcpOperations(this.store, s.id);
          const messages = this.store.messages(s.id);
          const lastAssistant = messages.findLastIndex((m) => m.role === 'assistant');
          const assistant = messages[lastAssistant];
          const returned = new Set(
            messages
              .slice(lastAssistant + 1)
              .filter((m) => m.role === 'tool')
              .map((m) => m.toolCallId),
          );
          for (const call of assistant?.toolCalls ?? [])
            if (!returned.has(call.id)) {
              this.store.message(s.id, {
                id: uuid(),
                role: 'tool',
                toolCallId: call.id,
                content: JSON.stringify({
                  status: 'unknown',
                  effectState: 'unknown',
                  error: {
                    code: 'HOST_INTERRUPTED',
                    message: 'Host 在工具结果提交前退出。未重放工具；继续前检查实际状态。',
                  },
                }),
              });
            }
        }
        if (this.store.inputs(s.id, 'pending').length) this.store.suspend(s.id);
        this.checkpoint(s.id);
      });
  }
}
