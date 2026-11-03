import { AuthService, scopes } from '@praxis/auth';
import { ChatRuntime } from '@praxis/chat-runtime';
import { assert } from '@praxis/contracts';
import { DeepSeekClient, type ModelClient } from '@praxis/model-core';
import type { PostgresDatabase } from '@praxis/storage-server';
import { UserInstructionRepository } from '@praxis/storage-server';
export function createChatService(
  database: PostgresDatabase,
  auth: AuthService,
  model: ModelClient = new DeepSeekClient(),
) {
  const instructions = new UserInstructionRepository(database);
  return new ChatRuntime(
    database,
    model,
    async (owner, providerId, signal) => {
      signal.throwIfAborted();
      const row = (
        await database.query<{ status: string }>('SELECT status FROM users WHERE id=$1', [owner])
      ).rows[0];
      assert(row?.status === 'active', 'UNAUTHENTICATED', '账号不可用。');
      return auth.beginUse(
        {
          userId: owner,
          sessionId: 'server-chat',
          username: '',
          admin: false,
          scopes: [...scopes],
          kind: 'web',
        },
        providerId,
        false,
      );
    },
    { userInstructions: (owner) => instructions.read(owner) },
  );
}
