import { AuthService } from '@praxis/auth';
import type { ChatRuntime } from '@praxis/chat-runtime';
import { assert, idSchema } from '@praxis/contracts';
import { streamSSE } from 'hono/streaming';
import type { HttpApp } from './http-types.ts';

export function registerEvents(app: HttpApp, auth: AuthService, chat: ChatRuntime) {
  app.get('/v1/chats/:id/events', async (c) => {
    const user = c.get('identity');
    auth.require(user, 'chats:read');
    const id = c.req.param('id');
    const pageId = c.req.query('pageId') ?? '';
    idSchema.parse(pageId);
    let after = Number(c.req.query('afterSeq') ?? 0);
    const last = c.req.header('last-event-id');
    if (last) {
      const [session, seq] = last.split(':');
      assert(session === id, 'INVALID_CURSOR', '事件游标所属会话不匹配。');
      after = Number(seq);
    }
    assert(Number.isSafeInteger(after), 'INVALID_CURSOR', '事件游标无效。');
    await chat.events(user.userId, id, after);
    return streamSSE(c, async (stream) => {
      let aborted = false;
      let deltaBytes = 0;
      const deltas: string[] = [];
      const onDelta = (event: { sessionId: string; text: string }) => {
        if (event.sessionId === id && deltaBytes < 64 * 1024) {
          const value = JSON.stringify(event);
          deltas.push(value);
          deltaBytes += Buffer.byteLength(value);
        }
      };
      chat.on('delta', onDelta);
      chat.streamState(user.userId, id, pageId, true);
      stream.onAbort(() => {
        aborted = true;
      });
      let heartbeat = Date.now();
      try {
        // Poll the committed cursor: no historical/live subscription race and bounded buffering.
        while (!aborted) {
          const events = await chat.events(user.userId, id, after);
          for (const event of events) {
            await stream.writeSSE({
              id: `${id}:${event.seq}`,
              event: 'session-event',
              data: JSON.stringify(event),
            });
            after = event.seq;
          }
          while (deltas.length) await stream.writeSSE({ event: 'delta', data: deltas.shift()! });
          deltaBytes = 0;
          if (Date.now() - heartbeat > 5000) {
            await stream.writeSSE({ event: 'heartbeat', data: '{}' });
            heartbeat = Date.now();
          }
          await stream.sleep(250);
        }
      } finally {
        chat.off('delta', onDelta);
        chat.streamState(user.userId, id, pageId, false);
      }
    });
  });
}
