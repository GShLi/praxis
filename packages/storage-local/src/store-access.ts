import type { Event, Message, Session } from '@praxis/contracts';
import type { DatabaseSync } from 'node:sqlite';
import type { InputRow } from './types.ts';
import type { ContextView } from './context-schema.ts';
/** Repositories share this transaction owner; they never open another database or publish before commit. */
export interface StoreAccess {
  readonly db: DatabaseSync;
  transaction<T>(body: () => T): T;
  get(id: string, owner?: string): Session;
  update(
    id: string,
    patch: Partial<Pick<Session, 'title' | 'status' | 'permission' | 'archived'>>,
  ): Session;
  append(
    id: string,
    type: string,
    payload: Record<string, unknown>,
    source?: Event['source'],
  ): Event;
  message(id: string, message: Message): void;
  messages(id: string): Message[];
  inputs(id: string, state: string): InputRow[];
  suspend(id: string, cancel?: boolean): void;
  checkpoint(id: string): void;
  context(id: string): ContextView;
}
