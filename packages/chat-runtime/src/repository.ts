import type { Event } from '@praxis/contracts';
import { assert } from '@praxis/contracts';
import type { ServerDatabase, SqlConnection } from '@praxis/storage-server';
import { randomUUID } from 'node:crypto';
import type { Chat, Generation } from './types.ts';
export class ChatRepository {
  constructor(readonly database: ServerDatabase) {}
  async event(
    sql: SqlConnection,
    id: string,
    type: string,
    payload: Record<string, unknown>,
    source: Event['source'] = 'host',
  ): Promise<Event> {
    const row = (
      await sql.query<{ latest_seq: number }>(
        'UPDATE chats SET latest_seq=latest_seq+1 WHERE id=$1 RETURNING latest_seq',
        [id],
      )
    ).rows[0];
    assert(row, 'SESSION_NOT_FOUND', '对话不存在。');
    const event: Event = {
      eventId: randomUUID(),
      sessionId: id,
      seq: row.latest_seq,
      type,
      payload,
      source,
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
    };
    await sql.query('INSERT INTO chat_events(session_id,seq,document) VALUES($1,$2,$3)', [
      id,
      event.seq,
      JSON.stringify(event),
    ]);
    return event;
  }
  async owned(owner: string, id: string, sql: SqlConnection = this.database, lock = false) {
    const row = (
      await sql.query<Chat>(
        `SELECT * FROM chats WHERE id=$1 AND owner=$2${lock ? ' FOR UPDATE' : ''}`,
        [id, owner],
      )
    ).rows[0];
    assert(row, 'SESSION_NOT_FOUND', '对话不存在。');
    return row;
  }
  async create(owner: string) {
    const id = randomUUID();
    await this.database.transaction(async (sql) => {
      await sql.query('INSERT INTO chats(id,owner,title) VALUES($1,$2,$3)', [id, owner, '新对话']);
      await this.event(sql, id, 'session/created', { kind: 'chat' }, 'user');
    });
    return this.owned(owner, id);
  }
  async list(owner: string) {
    return (
      await this.database.query<Chat>(
        'SELECT * FROM chats WHERE owner=$1 AND archived=false ORDER BY created_at DESC LIMIT 100',
        [owner],
      )
    ).rows;
  }
  async events(owner: string, id: string, after: number) {
    const chat = await this.owned(owner, id);
    assert(after >= 0 && after <= chat.latest_seq, 'INVALID_CURSOR', '事件游标无效。');
    return (
      await this.database.query<{ document: Event }>(
        'SELECT document FROM chat_events WHERE session_id=$1 AND seq>$2 ORDER BY seq LIMIT 500',
        [id, after],
      )
    ).rows.map((r) => r.document);
  }
  async history(owner: string, id: string) {
    const chat = await this.owned(owner, id);
    const inputs = (
      await this.database.query<{
        id: string;
        content: string;
        selected_generation: string | null;
      }>(
        'SELECT id,content,selected_generation FROM chat_inputs WHERE session_id=$1 ORDER BY ordinal',
        [id],
      )
    ).rows;
    const generations = (
      await this.database.query<Generation>(
        'SELECT id,input_id,status,content FROM chat_generations WHERE session_id=$1 ORDER BY created_at',
        [id],
      )
    ).rows;
    return { chat, inputs, generations, throughSeq: chat.latest_seq };
  }
  async recover() {
    await this.database.transaction(async (sql) => {
      const rows = (
        await sql.query<Generation>(
          "UPDATE chat_generations SET status='interrupted' WHERE status='running' RETURNING *",
        )
      ).rows;
      for (const row of rows) {
        await sql.query('UPDATE chats SET active_generation=NULL WHERE id=$1', [row.session_id]);
        await this.event(sql, row.session_id, 'generation/finished', {
          generationId: row.id,
          inputId: row.input_id,
          status: 'interrupted',
          content: row.content,
          reason: 'server_restart',
        });
      }
    });
  }
}
