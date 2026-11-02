import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { EventEmitter } from 'node:events';
import { assert, permissionSchema } from '../../contracts/src/index.ts';
import type { Event, Kind, Message, Prompt, Session } from '../../contracts/src/index.ts';

export const uuid = () => randomUUID();
export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export interface InputRow {
  id: string;
  sessionId: string;
  requestId: string;
  mode: 'queue' | 'steer';
  text: string;
  state: string;
  expectedTurnId: string | null;
  acceptedSeq: number;
}
type Row = Record<string, string | number | null>;

/** The writer publishes notifications only after the outer transaction commits. */
export class SessionStore extends EventEmitter {
  readonly db: DatabaseSync;
  private notifications: Event[] | undefined;
  constructor(path: string) {
    super();
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const version = (this.db.prepare('PRAGMA user_version').get() as Row).user_version;
    assert(
      version === 0 || version === 1,
      'STORAGE_VERSION_UNSUPPORTED',
      '数据库版本比程序新，请升级程序。',
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, owner TEXT NOT NULL, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, seq INTEGER NOT NULL, document TEXT NOT NULL, PRIMARY KEY(session_id,seq));
      CREATE TABLE IF NOT EXISTS inputs(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, request_id TEXT NOT NULL, digest TEXT NOT NULL, document TEXT NOT NULL, state TEXT NOT NULL, accepted_seq INTEGER NOT NULL, UNIQUE(session_id,request_id));
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS contexts(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, version INTEGER NOT NULL, document TEXT NOT NULL, PRIMARY KEY(session_id,version));
      CREATE TABLE IF NOT EXISTS checkpoints(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, seq INTEGER NOT NULL, document TEXT NOT NULL, PRIMARY KEY(session_id,seq));
      CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, kind TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, request_id TEXT NOT NULL, digest TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(session_id,request_id));
      PRAGMA user_version=1;
    `);
  }
  transaction<T>(body: () => T): T {
    if (this.notifications) return body();
    this.db.exec('BEGIN IMMEDIATE');
    this.notifications = [];
    let result: T;
    let emitted: Event[];
    try {
      result = body();
      this.db.exec('COMMIT');
      emitted = this.notifications;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.notifications = undefined;
    }
    // Subscribers are not part of the storage commit and cannot roll it back.
    for (const event of emitted)
      for (const listener of this.listeners('event')) {
        try {
          listener(event);
        } catch {
          /* disconnected observer */
        }
      }
    return result;
  }
  create(owner: string, kind: Kind, workspace?: string): Session {
    assert(kind !== 'agent' || workspace, 'WORKSPACE_REQUIRED', 'Agent 会话需要工作区。');
    const session: Session = {
      id: uuid(),
      ownerUserId: owner,
      kind,
      title: '新会话',
      status: 'idle',
      latestSeq: 0,
      createdAt: new Date().toISOString(),
      archived: false,
      permission: permissionSchema.parse({}),
      ...(workspace ? { workspace } : {}),
    };
    return this.transaction(() => {
      this.db
        .prepare('INSERT INTO sessions VALUES(?,?,?)')
        .run(session.id, owner, JSON.stringify(session));
      this.append(session.id, 'session/created', { kind }, 'user');
      return this.get(session.id, owner);
    });
  }
  get(id: string, owner?: string): Session {
    const row = this.db.prepare('SELECT owner,document FROM sessions WHERE id=?').get(id) as
      | Row
      | undefined;
    assert(row && (!owner || row.owner === owner), 'SESSION_NOT_FOUND', '会话不存在。');
    return JSON.parse(String(row.document)) as Session;
  }
  list(owner: string, limit = 100): Session[] {
    return (
      this.db
        .prepare('SELECT document FROM sessions WHERE owner=? ORDER BY rowid DESC LIMIT ?')
        .all(owner, Math.min(limit, 500)) as Row[]
    ).map((r) => JSON.parse(String(r.document)) as Session);
  }
  update(
    id: string,
    patch: Partial<Pick<Session, 'title' | 'status' | 'permission' | 'archived'>>,
  ): Session {
    const value = { ...this.get(id), ...patch };
    this.db.prepare('UPDATE sessions SET document=? WHERE id=?').run(JSON.stringify(value), id);
    return value;
  }
  append(
    id: string,
    type: string,
    payload: Record<string, unknown>,
    source: Event['source'] = 'host',
  ): Event {
    return this.transaction(() => {
      const session = this.get(id);
      const event: Event = {
        eventId: uuid(),
        sessionId: id,
        seq: session.latestSeq + 1,
        schemaVersion: 1,
        type,
        payload,
        source,
        timestamp: new Date().toISOString(),
      };
      this.db.prepare('INSERT INTO events VALUES(?,?,?)').run(id, event.seq, JSON.stringify(event));
      session.latestSeq = event.seq;
      this.db.prepare('UPDATE sessions SET document=? WHERE id=?').run(JSON.stringify(session), id);
      this.notifications!.push(event);
      return event;
    });
  }
  events(id: string, after = 0, limit = 500): Event[] {
    return (
      this.db
        .prepare('SELECT document FROM events WHERE session_id=? AND seq>? ORDER BY seq LIMIT ?')
        .all(id, after, Math.min(limit, 500)) as Row[]
    ).map((r) => JSON.parse(String(r.document)) as Event);
  }
  accept(
    prompt: Prompt,
    activeTurn?: string,
  ): { accepted: true; inputId: string; acceptedSeq: number } {
    const digest = hash(JSON.stringify(prompt));
    return this.transaction(() => {
      const previous = this.db
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
      const session = this.get(prompt.sessionId);
      assert(!session.archived, 'SESSION_ARCHIVED', '归档会话不能接收新任务。');
      assert(
        !prompt.expectedTurnId || prompt.expectedTurnId === activeTurn,
        'TURN_CONFLICT',
        '追加指导目标已结束。',
      );
      assert(session.kind !== 'chat' || !activeTurn, 'SESSION_BUSY', '此对话正在生成。');
      assert(
        this.inputs(prompt.sessionId, 'pending').length < 100,
        'QUEUE_FULL',
        '待处理输入已达到上限。',
      );
      const id = uuid();
      const event = this.append(
        prompt.sessionId,
        'input/accepted',
        { inputId: id, requestId: prompt.requestId, mode: prompt.mode, text: prompt.text },
        'user',
      );
      this.db
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
      this.db
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
    return this.transaction(() => {
      const pending = this.inputs(id, 'pending');
      const first = initial ? (pending.find((i) => i.mode === 'queue') ?? pending[0]) : undefined;
      const claimed = pending.filter(
        (i) =>
          i.id === first?.id ||
          (i.mode === 'steer' && (!i.expectedTurnId || i.expectedTurnId === turnId)),
      );
      for (const item of claimed) {
        this.db.prepare("UPDATE inputs SET state='claimed' WHERE id=?").run(item.id);
        this.append(id, 'input/claimed', { inputId: item.id, turnId });
        this.message(id, { id: item.id, role: 'user', content: item.text });
      }
      return claimed;
    });
  }
  suspend(id: string, cancel = false) {
    this.transaction(() => {
      this.db
        .prepare("UPDATE inputs SET state=? WHERE session_id=? AND state='pending'")
        .run(cancel ? 'cancelled' : 'suspended', id);
      this.append(id, 'input/suspended', { cancelled: cancel });
    });
  }
  message(id: string, message: Message) {
    return this.transaction(() => {
      const event = this.append(
        id,
        `${message.role}/message`,
        { message },
        message.role === 'user' ? 'user' : message.role === 'tool' ? 'tool' : 'model',
      );
      this.db
        .prepare('INSERT INTO messages VALUES(?,?,?,?)')
        .run(message.id, id, event.seq, JSON.stringify(message));
    });
  }
  messages(id: string): Message[] {
    return (
      this.db
        .prepare('SELECT document FROM messages WHERE session_id=? ORDER BY ordinal')
        .all(id) as Row[]
    ).map((r) => JSON.parse(String(r.document)) as Message);
  }
  context(id: string): {
    version: number;
    summary: Message | null;
    throughMessageId: string | null;
  } {
    const row = this.db
      .prepare('SELECT document FROM contexts WHERE session_id=? ORDER BY version DESC LIMIT 1')
      .get(id) as Row | undefined;
    return row
      ? JSON.parse(String(row.document))
      : { version: 0, summary: null, throughMessageId: null };
  }
  commitContext(
    id: string,
    expectedVersion: number,
    summary: Message,
    throughMessageId: string,
    sources: string[],
  ) {
    this.transaction(() => {
      assert(this.context(id).version === expectedVersion, 'CONTEXT_CONFLICT', '上下文已变化。');
      const value = { version: expectedVersion + 1, summary, throughMessageId, sources };
      this.db
        .prepare('INSERT INTO contexts VALUES(?,?,?)')
        .run(id, value.version, JSON.stringify(value));
      this.append(id, 'context/compaction_committed', value);
    });
  }
  artifact(id: string, kind: string, content: string): string {
    const row = this.db
      .prepare(
        'SELECT COALESCE(SUM(length(CAST(content AS BLOB))),0) AS size FROM artifacts WHERE session_id=?',
      )
      .get(id) as Row;
    assert(
      Number(row.size) + Buffer.byteLength(content) <= 200 * 1024 * 1024,
      'OUTPUT_LIMIT_EXCEEDED',
      '会话产物容量已满。',
    );
    const artifactId = uuid();
    this.db
      .prepare('INSERT INTO artifacts VALUES(?,?,?,?,?)')
      .run(artifactId, id, kind, content, new Date().toISOString());
    return artifactId;
  }
  readArtifact(id: string, artifactId: string): { kind: string; content: string } {
    const row = this.db
      .prepare('SELECT kind,content FROM artifacts WHERE id=? AND session_id=?')
      .get(artifactId, id) as Row | undefined;
    assert(row, 'ARTIFACT_UNAVAILABLE', '产物不存在或不属于此会话。');
    return { kind: String(row.kind), content: String(row.content) };
  }
  checkpoint(id: string) {
    this.transaction(() => {
      const session = this.get(id);
      const state = {
        schemaVersion: 1,
        throughSeq: session.latestSeq,
        session,
        context: this.context(id),
        suspended: this.inputs(id, 'suspended'),
      };
      this.db
        .prepare('INSERT OR REPLACE INTO checkpoints VALUES(?,?,?)')
        .run(id, session.latestSeq, JSON.stringify(state));
    });
  }
  recover() {
    const sessions = (this.db.prepare('SELECT document FROM sessions').all() as Row[]).map(
      (r) => JSON.parse(String(r.document)) as Session,
    );
    for (const s of sessions)
      this.transaction(() => {
        if (['running', 'waiting_input', 'waiting_approval', 'cancelling'].includes(s.status)) {
          this.update(s.id, { status: 'interrupted' });
          this.append(s.id, 'turn/interrupted', {
            reason: 'host_restart',
            effects: 'inspect_unfinished_tools',
            approvalsInvalidated: true,
          });
          const messages = this.messages(s.id);
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
              this.message(s.id, {
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
        if (this.inputs(s.id, 'pending').length) this.suspend(s.id);
        this.checkpoint(s.id);
      });
  }
  delete(id: string) {
    this.db.prepare('DELETE FROM sessions WHERE id=?').run(id);
  }
  close() {
    this.db.close();
  }
}
