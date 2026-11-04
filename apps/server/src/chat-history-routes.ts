import type { AuthService } from '@praxis/auth';
import type { ChatRuntime } from '@praxis/chat-runtime';
import { idSchema, sessionHistoryUpdateSchema } from '@praxis/contracts';
import { z } from 'zod';
import type { HttpApp } from './http-types.ts';

const includeArchivedSchema = z.enum(['true', 'false']).default('false');

export function registerChatHistory(app: HttpApp, auth: AuthService, chat: ChatRuntime) {
  app.get('/v1/chats', async (c) => {
    const user = c.get('identity');
    auth.require(user, 'chats:read');
    const includeArchived = includeArchivedSchema.parse(c.req.query('includeArchived')) === 'true';
    return c.json(await chat.list(user.userId, { includeArchived }));
  });
  app.patch('/v1/chats/:id', async (c) => {
    const user = c.get('identity');
    auth.require(user, 'chats:write');
    const id = idSchema.parse(c.req.param('id'));
    const input = sessionHistoryUpdateSchema.parse(await c.req.json());
    return c.json(await chat.update(user.userId, id, input));
  });
}
