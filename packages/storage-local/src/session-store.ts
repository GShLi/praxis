import type { Event, Kind, Session } from '@praxis/contracts';
import { assert, permissionSchema } from '@praxis/contracts';
import { EventEmitter } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './database.ts';
import { HistoryRepository } from './history-repository.ts';
import { uuid } from './identity.ts';
import { InputRepository } from './input-repository.ts';
import { MaintenanceRepository } from './maintenance-repository.ts';
import { RecoveryRepository } from './recovery-repository.ts';
import type { Row } from './types.ts';

/** The writer publishes notifications only after the outer transaction commits. */
export class SessionStore extends EventEmitter {
  private inputRepository: InputRepository;
  private historyRepository: HistoryRepository;
  private recoveryRepository: RecoveryRepository;
  private maintenanceRepository: MaintenanceRepository;

  readonly db: DatabaseSync;
  private notifications: Event[] | undefined;
  constructor(path: string) {
    super();
    this.db = openDatabase(path);
    this.inputRepository = new InputRepository(this);
    this.historyRepository = new HistoryRepository(this);
    this.recoveryRepository = new RecoveryRepository(this);
    this.maintenanceRepository = new MaintenanceRepository(this);
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
  accept(...args: Parameters<InputRepository['accept']>) {
    return this.inputRepository.accept(...args);
  }
  inputs(...args: Parameters<InputRepository['inputs']>) {
    return this.inputRepository.inputs(...args);
  }
  claim(...args: Parameters<InputRepository['claim']>) {
    return this.inputRepository.claim(...args);
  }
  suspend(...args: Parameters<InputRepository['suspend']>) {
    return this.inputRepository.suspend(...args);
  }
  message(...args: Parameters<HistoryRepository['message']>) {
    return this.historyRepository.message(...args);
  }
  messages(...args: Parameters<HistoryRepository['messages']>) {
    return this.historyRepository.messages(...args);
  }
  context(...args: Parameters<HistoryRepository['context']>) {
    return this.historyRepository.context(...args);
  }
  commitContext(...args: Parameters<HistoryRepository['commitContext']>) {
    return this.historyRepository.commitContext(...args);
  }
  artifact(...args: Parameters<HistoryRepository['artifact']>) {
    return this.historyRepository.artifact(...args);
  }
  readArtifact(...args: Parameters<HistoryRepository['readArtifact']>) {
    return this.historyRepository.readArtifact(...args);
  }
  checkpoint(...args: Parameters<RecoveryRepository['checkpoint']>) {
    return this.recoveryRepository.checkpoint(...args);
  }
  recover(...args: Parameters<RecoveryRepository['recover']>) {
    return this.recoveryRepository.recover(...args);
  }
  delete(id: string) {
    this.db.prepare('DELETE FROM sessions WHERE id=?').run(id);
  }
  startMaintenance(...args: Parameters<MaintenanceRepository['startMaintenance']>) {
    return this.maintenanceRepository.startMaintenance(...args);
  }
  finishMaintenance(...args: Parameters<MaintenanceRepository['finishMaintenance']>) {
    return this.maintenanceRepository.finishMaintenance(...args);
  }
  close() {
    this.db.close();
  }
}
