import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { PostgresDatabase, migrate } from '../../../packages/storage-server/src/index.ts';
import { AuthService, SecretCipher, scopes } from '../../../packages/auth/src/index.ts';
import { DeepSeekClient } from '../../../packages/model-core/src/index.ts';
import { ChatRuntime } from '../../../packages/chat-runtime/src/index.ts';
import { assert, safeError } from '../../../packages/contracts/src/index.ts';
import { createApp } from './app.ts';

async function secretPrompt(prompt: string): Promise<string> {
  assert(process.stdin.isTTY, 'TTY_REQUIRED', '管理员密码必须通过交互终端输入。');
  process.stderr.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = () => {
      process.stdin.off('data', data);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write('\n');
    };
    const data = (chunk: Buffer) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          finish();
          reject(new Error('cancelled'));
          return;
        }
        if (ch === '\u007f') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    process.stdin.on('data', data);
  });
}
async function main() {
  if (process.argv[2] === 'keygen') {
    console.log(randomBytes(32).toString('base64'));
    return;
  }
  const url = process.env.PRAXIS_DATABASE_URL;
  assert(url, 'DATABASE_REQUIRED', '请配置 PRAXIS_DATABASE_URL。');
  const database = new PostgresDatabase(url);
  if (process.argv[2] === 'migrate') {
    try {
      await migrate(database);
      console.log('数据库迁移完成。');
    } finally {
      await database.close();
    }
    return;
  }
  const master = process.env.PRAXIS_MASTER_KEY;
  assert(master, 'MASTER_KEY_REQUIRED', '请配置独立的 PRAXIS_MASTER_KEY（32 字节 Base64）。');
  const auth = new AuthService(
    database,
    new SecretCipher(new Map([['1', Buffer.from(master, 'base64')]]), '1'),
  );
  if (process.argv[2] === 'create-user') {
    try {
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      const username = await terminal.question('账号：');
      terminal.close();
      const password = await secretPrompt('密码（至少 12 字节，不回显）：');
      await auth.createUser(username, password, true);
      console.log('账号已创建。');
    } finally {
      await database.close();
    }
    return;
  }
  const origin = process.env.PRAXIS_PUBLIC_ORIGIN ?? 'http://127.0.0.1:4310';
  const parsed = new URL(origin);
  assert(
    parsed.origin === origin && !parsed.username && !parsed.password,
    'INVALID_ORIGIN',
    '公共来源只能包含协议、主机和端口。',
  );
  assert(
    parsed.protocol === 'https:' || ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname),
    'TLS_REQUIRED',
    '非本机部署必须使用 HTTPS 来源。',
  );
  // Dedicated connection holds a process-scoped lock: V1 is explicitly single-instance.
  const lease = await database.pool.connect();
  const locked = await lease.query<{ acquired: boolean }>(
    'SELECT pg_try_advisory_lock(707261786974) AS acquired',
  );
  assert(locked.rows[0]?.acquired, 'SERVER_ALREADY_RUNNING', '数据库已有 Praxis 服务实例。');
  lease.on('error', () => process.kill(process.pid, 'SIGTERM'));
  const chat = new ChatRuntime(
    database,
    new DeepSeekClient(),
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
  );
  await chat.recover();
  const webRoot = fileURLToPath(
    new URL(import.meta.url.endsWith('.mjs') ? '../web' : '../../../dist/web', import.meta.url),
  );
  const app = createApp(auth, chat, origin, webRoot);
  const port = Number(process.env.PRAXIS_PORT ?? 4310);
  const server = serve(
    { fetch: app.fetch, port, hostname: process.env.PRAXIS_BIND ?? '127.0.0.1' },
    () => console.log(`Praxis Server: ${origin}`),
  );
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => process.exit(1), 5000);
    server.close();
    await chat.close();
    await lease.query('SELECT pg_advisory_unlock(707261786974)');
    lease.release();
    await database.close();
    clearTimeout(deadline);
    process.exit(0);
  };
  process.once('SIGTERM', () => {
    void close();
  });
  process.once('SIGINT', () => {
    void close();
  });
}
main().catch((error: unknown) => {
  const safe = safeError(error);
  console.error(`${safe.code}: ${safe.safeMessage}`);
  process.exitCode = 1;
});
