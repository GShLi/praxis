import { digest } from '@praxis/auth';
import type { Event, ModelConfig } from '@praxis/contracts';
import { assert } from '@praxis/contracts';
import type { ModelClient } from '@praxis/model-core';
import type { ServerDatabase } from '@praxis/storage-server';
import { randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { generateChat } from './generation.ts';
import { ChatRepository } from './repository.ts';
import type { Running } from './types.ts';

/** Server Chat only: this module has no file, process, workspace or tool executor. */
export class ChatRuntime extends EventEmitter {
  private repository: ChatRepository;
  private running = new Map<string, Running>();
  private stopped = false;
  private streams = new Map<string, number>();
  private watchdog: NodeJS.Timeout;
  constructor(
    readonly database: ServerDatabase,
    private model: ModelClient,
    private beginUse: (
      owner: string,
      providerId: string,
      signal: AbortSignal,
    ) => Promise<ModelConfig>,
  ) {
    super();
    this.repository = new ChatRepository(database);
    this.watchdog = setInterval(() => {
      for (const run of this.running.values())
        if (
          Date.now() - run.heartbeat > 15_000 ||
          (run.disconnectedAt !== null && Date.now() - run.disconnectedAt > 5000)
        )
          run.controller.abort();
    }, 1000);
    this.watchdog.unref();
  }

  private async append(
    id: string,
    type: string,
    payload: Record<string, unknown>,
    source: Event['source'] = 'host',
  ) {
    const event = await this.database.transaction((sql) =>
      this.repository.event(sql, id, type, payload, source),
    );
    this.emit('event', event);
    return event;
  }
  owned(...args: Parameters<ChatRepository['owned']>) {
    return this.repository.owned(...args);
  }
  create(...args: Parameters<ChatRepository['create']>) {
    return this.repository.create(...args);
  }
  list(...args: Parameters<ChatRepository['list']>) {
    return this.repository.list(...args);
  }
  events(...args: Parameters<ChatRepository['events']>) {
    return this.repository.events(...args);
  }
  history(...args: Parameters<ChatRepository['history']>) {
    return this.repository.history(...args);
  }
  async submit(
    owner: string,
    id: string,
    input: { requestId: string; text?: string; providerId: string; pageId: string },
    regenerate = false,
  ) {
    assert(!this.stopped, 'SERVER_CLOSING', '服务正在关闭。');
    const requestDigest = digest(JSON.stringify({ ...input, regenerate }));
    const lease = randomBytes(32).toString('base64url');
    const accepted = await this.database.transaction(async (sql) => {
      const chat = await this.owned(owner, id, sql, true);
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
      const event = await this.repository.event(
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
    if (accepted.duplicate)
      return {
        accepted: true,
        ...accepted,
        lease: this.running.get(accepted.generationId)?.lease ?? null,
      };
    const run: Running = {
      id: accepted.generationId,
      chatId: id,
      owner,
      controller: new AbortController(),
      lease,
      pageId: input.pageId,
      heartbeat: Date.now(),
      disconnectedAt: this.streams.has(JSON.stringify([owner, id, input.pageId]))
        ? null
        : Date.now(),
      content: '',
      done: Promise.resolve(),
    };
    this.running.set(run.id, run);
    run.done = this.generate(run, input.providerId, accepted.inputId).finally(() =>
      this.running.delete(run.id),
    );
    void run.done.catch(() => this.emit('fatal', { code: 'STORAGE_FAILURE' }));
    return { accepted: true, ...accepted, lease };
  }
  heartbeat(owner: string, id: string, generationId: string, pageId: string, lease: string) {
    const run = this.running.get(generationId);
    assert(
      run &&
        run.chatId === id &&
        run.owner === owner &&
        run.pageId === pageId &&
        digest(run.lease) === digest(lease),
      'LEASE_EXPIRED',
      '页面执行租期已失效。',
    );
    run.heartbeat = Date.now();
    return { ok: true };
  }
  streamState(owner: string, id: string, pageId: string, connected: boolean) {
    const key = JSON.stringify([owner, id, pageId]);
    const count = Math.max(0, (this.streams.get(key) ?? 0) + (connected ? 1 : -1));
    if (count) this.streams.set(key, count);
    else this.streams.delete(key);
    for (const run of this.running.values())
      if (run.owner === owner && run.chatId === id && run.pageId === pageId)
        run.disconnectedAt = count ? null : Date.now();
  }
  async cancel(owner: string, id: string, generationId: string) {
    await this.owned(owner, id);
    const run = this.running.get(generationId);
    if (run?.chatId === id) run.controller.abort();
    return { accepted: true };
  }

  private generate(run: Running, providerId: string, inputId: string) {
    return generateChat(
      {
        database: this.database,
        model: this.model,
        repository: this.repository,
        append: this.append.bind(this),
        beginUse: this.beginUse,
        emit: (name, payload) => {
          this.emit(name, payload);
        },
      },
      run,
      providerId,
      inputId,
    );
  }
  recover(...args: Parameters<ChatRepository['recover']>) {
    return this.repository.recover(...args);
  }
  async close() {
    this.stopped = true;
    clearInterval(this.watchdog);
    for (const run of this.running.values()) run.controller.abort();
    await Promise.allSettled([...this.running.values()].map((r) => r.done));
  }
}
