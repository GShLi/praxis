import { AuthService } from '@praxis/auth';
import type { ChatRuntime } from '@praxis/chat-runtime';
import { idSchema, textSchema } from '@praxis/contracts';
import { z } from 'zod';
import type { HttpApp } from './http-types.ts';

export function registerChat(app: HttpApp, auth: AuthService, chat: ChatRuntime) {
  app.get('/v1/chats', async (c) => {
    const user = c.get('identity');
    auth.require(user, 'chats:read');
    return c.json(await chat.list(user.userId));
  });
  app.post('/v1/chats', async (c) => {
    const user = c.get('identity');
    auth.require(user, 'chats:write');
    return c.json(await chat.create(user.userId), 201);
  });
  app.get('/v1/chats/:id/history', async (c) => {
    const user = c.get('identity');
    auth.require(user, 'chats:read');
    return c.json(await chat.history(user.userId, c.req.param('id')));
  });
  app.post('/v1/chats/:id/messages', async (c) => {
    const user = c.get('identity');
    auth.require(user, 'chats:write');
    const input = z
      .strictObject({
        requestId: idSchema,
        text: textSchema,
        providerId: idSchema,
        pageId: idSchema,
      })
      .parse(await c.req.json());
    return c.json(await chat.submit(user.userId, c.req.param('id'), input), 202);
  });
  app.post('/v1/chats/:id/regenerate', async (c) => {
    const user = c.get('identity');
    auth.require(user, 'chats:write');
    const input = z
      .strictObject({ requestId: idSchema, providerId: idSchema, pageId: idSchema })
      .parse(await c.req.json());
    return c.json(await chat.submit(user.userId, c.req.param('id'), input, true), 202);
  });
  app.post('/v1/chats/:id/generations/:generationId/cancel', async (c) => {
    const user = c.get('identity');
    auth.require(user, 'chats:write');
    return c.json(
      await chat.cancel(user.userId, c.req.param('id'), c.req.param('generationId')),
      202,
    );
  });
  app.post('/v1/chats/:id/generations/:generationId/heartbeat', async (c) => {
    const user = c.get('identity');
    auth.require(user, 'chats:write');
    const input = z
      .strictObject({ pageId: idSchema, lease: z.string().min(32).max(128) })
      .parse(await c.req.json());
    return c.json(
      chat.heartbeat(
        user.userId,
        c.req.param('id'),
        c.req.param('generationId'),
        input.pageId,
        input.lease,
      ),
    );
  });
}
