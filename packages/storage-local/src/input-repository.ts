import type { Prompt, UserCommand } from '@praxis/contracts';
import { assert } from '@praxis/contracts';
import { hash, uuid } from './identity.ts';
import type { StoreAccess } from './store-access.ts';
import type { InputRow, Row } from './types.ts';
export class InputRepository {
  constructor(
    private store: Pick<StoreAccess, 'transaction' | 'db' | 'get' | 'append' | 'message'>,
  ) {}
  accept(
    prompt: Prompt & { command?: UserCommand },
    activeTurn?: string,
    validate?: () => void,
  ): { accepted: true; inputId: string; acceptedSeq: number } {
    const digest = hash(JSON.stringify(prompt));
    return this.store.transaction(() => {
      const previous = this.store.db
        .prepare('SELECT * FROM inputs WHERE session_id=? AND request_id=?')
        .get(prompt.sessionId, prompt.requestId) as Row | undefined;
      if (previous) {
        assert(previous.digest === digest, 'REQUEST_CONFLICT', 'requestId 已用于不同输入。');
        return {
          accepted: true,
          inputId: String(previous.id),
          acceptedSeq: Number(previous.accepted_seq),
        };
      }
      const session = this.store.get(prompt.sessionId);
      validate?.();
      assert(!session.archived, 'SESSION_ARCHIVED', '归档会话不能接收新任务。');
      assert(
        !prompt.expectedTurnId || prompt.expectedTurnId === activeTurn,
        'TURN_CONFLICT',
        '追加指导目标已结束。',
      );
      assert(
        prompt.mode !== 'steer' || (activeTurn && prompt.expectedTurnId === activeTurn),
        'TURN_CONFLICT',
        '追加指导必须绑定当前活动任务。',
      );
      assert(session.kind !== 'chat' || !activeTurn, 'SESSION_BUSY', '此对话正在生成。');
      assert(
        this.inputs(prompt.sessionId, 'pending').length < 100,
        'QUEUE_FULL',
        '待处理输入已达到上限。',
      );
      const id = uuid();
      const event = this.store.append(
        prompt.sessionId,
        'input/accepted',
        { inputId: id, requestId: prompt.requestId, mode: prompt.mode, text: prompt.text },
        'user',
      );
      this.store.db
        .prepare('INSERT INTO inputs VALUES(?,?,?,?,?,?,?)')
        .run(
          id,
          prompt.sessionId,
          prompt.requestId,
          digest,
          JSON.stringify({ ...prompt, id }),
          'pending',
          event.seq,
        );
      return { accepted: true, inputId: id, acceptedSeq: event.seq };
    });
  }
  inputs(id: string, state: string): InputRow[] {
    return (
      this.store.db
        .prepare('SELECT * FROM inputs WHERE session_id=? AND state=? ORDER BY accepted_seq')
        .all(id, state) as Row[]
    ).map(
      (r) =>
        ({
          ...JSON.parse(String(r.document)),
          state: r.state,
          acceptedSeq: r.accepted_seq,
        }) as InputRow,
    );
  }
  claim(id: string, turnId: string, initial: boolean): InputRow[] {
    return this.store.transaction(() => {
      const pending = this.inputs(id, 'pending');
      const first = initial ? (pending.find((i) => i.mode === 'queue') ?? pending[0]) : undefined;
      const claimed = pending.filter(
        (i) =>
          i.id === first?.id ||
          (i.mode === 'steer' && (!i.expectedTurnId || i.expectedTurnId === turnId)),
      );
      for (const item of claimed) {
        this.store.db.prepare("UPDATE inputs SET state='claimed' WHERE id=?").run(item.id);
        this.store.append(id, 'input/claimed', { inputId: item.id, turnId });
        this.store.message(id, { id: item.id, role: 'user', content: item.text });
      }
      return claimed;
    });
  }
  suspend(id: string, cancel = false) {
    this.store.transaction(() => {
      this.store.db
        .prepare("UPDATE inputs SET state=? WHERE session_id=? AND state='pending'")
        .run(cancel ? 'cancelled' : 'suspended', id);
      this.store.append(id, 'input/suspended', { cancelled: cancel });
    });
  }
}
