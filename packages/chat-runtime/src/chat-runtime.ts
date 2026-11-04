import { digest } from '@praxis/auth';
import type { Event, ModelConfig, UserInstructionSettings } from '@praxis/contracts';
import { assert } from '@praxis/contracts';
import type { ModelClient } from '@praxis/model-core';
import type { ServerDatabase } from '@praxis/storage-server';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { generateChat } from './generation.ts';
import { ChatRepository } from './repository.ts';
import { acceptSubmission, type ChatSubmission } from './submission.ts';
import type { Running } from './types.ts';

/** Server Chat only: this module has no file, process, workspace or tool executor. */
export class ChatRuntime extends EventEmitter {
  private repository: ChatRepository;
  private running = new Map<string, Running>();
  private stopped = false;
  private submissions = new Set<Promise<unknown>>();
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
    private options: {
      userInstructions?: (owner: string, signal: AbortSignal) => Promise<UserInstructionSettings>;
    } = {},
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
  update(...args: Parameters<ChatRepository['update']>) {
    return this.repository.update(...args);
  }
  events(...args: Parameters<ChatRepository['events']>) {
    return this.repository.events(...args);
  }
  history(...args: Parameters<ChatRepository['history']>) {
    return this.repository.history(...args);
  }
  async submit(owner: string, id: string, input: ChatSubmission, regenerate = false) {
    assert(!this.stopped, 'SERVER_CLOSING', '服务正在关闭。');
    const operation = this.accept(owner, id, input, regenerate);
    this.submissions.add(operation);
    try {
      return await operation;
    } finally {
      this.submissions.delete(operation);
    }
  }
  private async accept(owner: string, id: string, input: ChatSubmission, regenerate: boolean) {
    const lease = randomBytes(32).toString('base64url');
    const accepted = await acceptSubmission(
      this.database,
      this.repository,
      owner,
      id,
      input,
      regenerate,
      lease,
    );
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
    if (this.stopped) run.controller.abort();
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
        userInstructions: this.options.userInstructions,
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
    // An accepted transaction may still be awaiting its continuation. Drain it before releasing DB resources.
    await Promise.allSettled([...this.submissions]);
    await Promise.allSettled([...this.running.values()].map((r) => r.done));
  }
}
