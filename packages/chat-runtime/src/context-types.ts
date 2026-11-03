import type { Event } from '@praxis/contracts';
import type { ModelClient } from '@praxis/model-core';
import type { ServerDatabase } from '@praxis/storage-server';
import type { ChatRepository } from './repository.ts';
export interface ChatContextServices {
  database: ServerDatabase;
  model: ModelClient;
  repository: ChatRepository;
  emit: (name: string, payload: unknown) => void;
  append: (
    id: string,
    type: string,
    payload: Record<string, unknown>,
    source?: Event['source'],
  ) => Promise<Event>;
}
