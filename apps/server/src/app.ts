import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { streamSSE } from 'hono/streaming';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { assert, idSchema, safeError, textSchema } from '../../../packages/contracts/src/index.ts';
import {
  AuthService,
  digest,
  providerInputSchema,
  scopes,
} from '../../../packages/auth/src/index.ts';
import type { Identity } from '../../../packages/auth/src/index.ts';
import type { ChatRuntime } from '../../../packages/chat-runtime/src/index.ts';

const loginSchema = z.strictObject({
  username: z.string().min(1).max(100),
  password: z.string().max(1024),
  kind: z.enum(['web', 'client']).default('web'),
});
export function createApp(auth: AuthService, chat: ChatRuntime, publicOrigin: string) {
  const origin = new URL(publicOrigin).origin;
  const secure = origin.startsWith('https://');
  const app = new Hono<{ Variables: { identity: Identity } }>();
  const rate = new Map<string, { count: number; until: number }>();
  app.use('*', secureHeaders());
  app.use(
    '/v1/*',
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (c) =>
        c.json(
          { code: 'BODY_TOO_LARGE', safeMessage: '请求超过大小限制。', retryable: false },
          413,
        ),
    }),
  );
  app.use('/v1/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.onError((error, c) => {
    const safe = safeError(error);
    const code = safe.code;
    const status =
      code === 'UNAUTHENTICATED' || code === 'AUTH_FAILED'
        ? 401
        : code === 'FORBIDDEN' || code === 'CSRF_FAILED'
          ? 403
          : code.endsWith('_NOT_FOUND')
            ? 404
            : code.includes('CONFLICT') || code === 'SESSION_BUSY'
              ? 409
              : code === 'RATE_LIMITED'
                ? 429
                : code === 'INTERNAL_ERROR'
                  ? 500
                  : 400;
    return c.json(safe, status);
  });
  const checkOrigin = (value: string | undefined) =>
    assert(value === origin, 'CSRF_FAILED', '请求来源不匹配。');
  const cookies = (
    c: Parameters<typeof setCookie>[0],
    result: { accessToken: string; refreshToken: string },
  ) => {
    setCookie(c, 'praxis_session', result.accessToken, {
      httpOnly: true,
      secure,
      sameSite: 'Strict',
      path: '/',
      maxAge: 900,
    });
    setCookie(c, 'praxis_refresh', result.refreshToken, {
      httpOnly: true,
      secure,
      sameSite: 'Strict',
      path: '/v1/auth',
      maxAge: 30 * 86400,
    });
  };
  app.get('/health/live', (c) => c.json({ ok: true }));
  app.get('/health/ready', async (c) => {
    await auth.database.query('SELECT 1');
    return c.json({ ok: true });
  });
  app.post('/v1/auth/login', async (c) => {
    const input = loginSchema.parse(await c.req.json());
    if (input.kind === 'web') checkOrigin(c.req.header('origin'));
    const key = input.username.toLowerCase();
    const previous = rate.get(key);
    const now = Date.now();
    const bucket = previous && previous.until > now ? previous : { count: 0, until: now + 60_000 };
    assert(++bucket.count <= 5, 'RATE_LIMITED', '尝试过于频繁，请稍后再试。');
    rate.set(key, bucket);
    if (rate.size > 5000) for (const [k, v] of rate) if (v.until < now) rate.delete(k);
    const result = await auth.login(input.username, input.password, input.kind);
    if (input.kind === 'web') {
      cookies(c, result);
      return c.json({ expiresAt: result.expiresAt, csrfToken: result.csrfToken });
    }
    return c.json(result);
  });
  app.post('/v1/auth/refresh', async (c) => {
    const webToken = getCookie(c, 'praxis_refresh');
    const body = webToken
      ? undefined
      : z.strictObject({ refreshToken: z.string().min(20).max(1024) }).parse(await c.req.json());
    if (webToken) checkOrigin(c.req.header('origin'));
    const result = await auth.refresh(webToken ?? body!.refreshToken, Boolean(webToken));
    if (webToken) {
      cookies(c, result);
      return c.json({ expiresAt: result.expiresAt, csrfToken: result.csrfToken });
    }
    return c.json(result);
  });
  app.use('/v1/*', async (c, next) => {
    const authorization = c.req.header('authorization');
    const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    const token = bearer ?? getCookie(c, 'praxis_session');
    assert(token, 'UNAUTHENTICATED', '请登录 Praxis。');
    const identity = await auth.authenticate(token);
    if (identity.kind === 'web' && !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      checkOrigin(c.req.header('origin'));
      const csrf = c.req.header('x-csrf-token');
      assert(
        csrf && digest(csrf) === identity.csrfHash,
        'CSRF_FAILED',
        '页面安全令牌已失效，请刷新。',
      );
    }
    c.set('identity', identity);
    await next();
  });
  app.post('/v1/auth/token', async (c) => c.json(await auth.exchange(c.get('identity'))));
  app.post('/v1/auth/logout', async (c) => {
    await auth.logout(c.get('identity'));
    deleteCookie(c, 'praxis_session', { path: '/' });
    deleteCookie(c, 'praxis_refresh', { path: '/v1/auth' });
    return c.json({ ok: true });
  });
  app.get('/v1/me', async (c) => {
    const identity = c.get('identity');
    auth.require(identity, 'profile:read');
    let csrfToken: string | undefined;
    if (identity.kind === 'web') {
      csrfToken = randomBytes(32).toString('base64url');
      await auth.database.query('UPDATE auth_sessions SET csrf_hash=$1 WHERE id=$2', [
        digest(csrfToken),
        identity.sessionId,
      ]);
    }
    return c.json({
      id: identity.userId,
      username: identity.username,
      scopes: identity.scopes,
      ...(csrfToken ? { csrfToken } : {}),
    });
  });
  app.get('/v1/api-keys', async (c) => {
    const user = c.get('identity');
    auth.require(user, 'keys:write');
    return c.json(
      (
        await auth.database.query(
          'SELECT id,name,scopes,expires_at,revoked_at,last_used_at FROM api_keys WHERE user_id=$1',
          [user.userId],
        )
      ).rows,
    );
  });
  app.post('/v1/api-keys', async (c) => {
    const input = z
      .strictObject({
        name: z.string().min(1).max(100),
        scopes: z.array(z.enum(scopes)).min(1),
        days: z.number().int().min(1).max(365).default(90),
      })
      .parse(await c.req.json());
    return c.json(
      await auth.createApiKey(c.get('identity'), input.name, input.scopes, input.days),
      201,
    );
  });
  app.delete('/v1/api-keys/:id', async (c) => {
    const identity = c.get('identity');
    auth.require(identity, 'keys:write');
    await auth.database.query('UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND user_id=$2', [
      c.req.param('id'),
      identity.userId,
    ]);
    return c.json({ ok: true });
  });
  app.get('/v1/providers', async (c) => c.json(await auth.listProviders(c.get('identity'))));
  app.post('/v1/providers', async (c) => {
    const input = z
      .strictObject({ config: providerInputSchema, apiKey: z.string().min(1).max(4096) })
      .parse(await c.req.json());
    return c.json(await auth.saveProvider(c.get('identity'), input.config, input.apiKey), 201);
  });
  app.put('/v1/providers/:id', async (c) => {
    const input = z
      .strictObject({
        config: providerInputSchema,
        apiKey: z.string().min(1).max(4096).optional(),
        expectedRevision: z.number().int().min(1),
      })
      .parse(await c.req.json());
    return c.json(
      await auth.saveProvider(
        c.get('identity'),
        input.config,
        input.apiKey,
        c.req.param('id'),
        input.expectedRevision,
      ),
    );
  });
  app.delete('/v1/providers/:id', async (c) => {
    const identity = c.get('identity');
    auth.require(identity, 'providers:write');
    const input = z
      .strictObject({ expectedRevision: z.number().int().min(1) })
      .parse(await c.req.json());
    const result = await auth.database.query(
      'DELETE FROM provider_configs WHERE id=$1 AND user_id=$2 AND revision=$3',
      [c.req.param('id'), identity.userId, input.expectedRevision],
    );
    assert(result.rowCount, 'CONFIG_CONFLICT', '配置不存在或已变化。');
    return c.json({ ok: true });
  });
  app.post('/v1/client/provider-uses', async (c) => {
    const input = z.strictObject({ providerId: idSchema }).parse(await c.req.json());
    const identity = c.get('identity');
    assert(identity.kind !== 'web', 'FORBIDDEN', 'Web 页面不能读取厂商 Key。');
    return c.json(await auth.beginUse(identity, input.providerId, true));
  });
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
  return app;
}
