import { digest } from '@praxis/auth';
import { assert } from '@praxis/contracts';
import type { ServerDatabase } from '@praxis/storage-server';
import { randomUUID } from 'node:crypto';
import type { ChatRepository } from './repository.ts';
export interface ChatSubmission {
  requestId: string;
  text?: string;
  providerId: string;
  pageId: string;
}
/** Atomically deduplicates input, reserves generation and records acceptance. */
export async function acceptSubmission(
  database: ServerDatabase,
  repository: ChatRepository,
  owner: string,
  id: string,
  input: ChatSubmission,
  regenerate: boolean,
  lease: string,
) {
  const requestDigest = digest(JSON.stringify({ ...input, regenerate }));
  return database.transaction(async (sql) => {
    const chat = await repository.owned(owner, id, sql, true);
    const prior = (
      await sql.query<{
        digest: string;
        result: { generationId: string; inputId: string; acceptedSeq: number };
      }>('SELECT digest,result FROM chat_requests WHERE session_id=$1 AND request_id=$2', [
        id,
        input.requestId,
      ])
    ).rows[0];
    if (prior) {
      assert(prior.digest === requestDigest, 'REQUEST_CONFLICT', 'requestId 已用于不同请求。');
      return { ...prior.result, duplicate: true };
    }
    assert(!chat.active_generation && !chat.archived, 'SESSION_BUSY', '对话正在生成或已归档。');
    let inputId: string;
    let text: string;
    if (regenerate) {
      const latest = (
        await sql.query<{ id: string; content: string }>(
          'SELECT id,content FROM chat_inputs WHERE session_id=$1 ORDER BY ordinal DESC LIMIT 1',
          [id],
        )
      ).rows[0];
      assert(latest, 'INVALID_STATE', '没有可以重新生成的回答。');
      inputId = latest.id;
      text = latest.content;
      await sql.query('UPDATE chat_contexts SET valid=false WHERE session_id=$1', [id]);
    } else {
      assert(input.text?.trim(), 'INVALID_ARGUMENT', '消息不能为空。');
      inputId = randomUUID();
      text = input.text!;
      await sql.query(
        'INSERT INTO chat_inputs(id,session_id,request_id,digest,content,ordinal) VALUES($1,$2,$3,$4,$5,$6)',
        [inputId, id, input.requestId, requestDigest, text, chat.latest_seq + 1],
      );
    }
    const generationId = randomUUID();
    await sql.query(
      'INSERT INTO chat_generations(id,session_id,input_id,status,page_id,lease_hash) VALUES($1,$2,$3,$4,$5,$6)',
      [generationId, id, inputId, 'running', input.pageId, digest(lease)],
    );
    await sql.query(
      'UPDATE chats SET active_generation=$1,title=CASE WHEN title=$2 THEN $3 ELSE title END WHERE id=$4',
      [generationId, '新对话', text.slice(0, 60), id],
    );
    const event = await repository.event(
      sql,
      id,
      regenerate ? 'generation/accepted' : 'input/accepted',
      { inputId, generationId, text, regenerate },
      'user',
    );
    const result = { generationId, inputId, acceptedSeq: event.seq };
    await sql.query('INSERT INTO chat_requests VALUES($1,$2,$3,$4)', [
      id,
      input.requestId,
      requestDigest,
      JSON.stringify(result),
    ]);
    return { ...result, duplicate: false };
  });
}
