import { AuthService, SecretCipher } from '@praxis/auth';
import { assert, safeError } from '@praxis/contracts';
import { PostgresDatabase, migrate } from '@praxis/storage-server';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createAdmin } from './admin.ts';
import { runServer } from './server-process.ts';

async function main() {
  const command = process.argv[2];
  if (command === 'keygen') {
    console.log(randomBytes(32).toString('base64'));
    return;
  }
  const url = process.env.PRAXIS_DATABASE_URL;
  assert(url, 'DATABASE_REQUIRED', '请配置 PRAXIS_DATABASE_URL。');
  const database = new PostgresDatabase(url);
  try {
    if (command === 'migrate') {
      await migrate(database);
      console.log('数据库迁移完成。');
      return;
    }
    const master = process.env.PRAXIS_MASTER_KEY;
    assert(master, 'MASTER_KEY_REQUIRED', '请配置独立的 PRAXIS_MASTER_KEY（32 字节 Base64）。');
    const auth = new AuthService(
      database,
      new SecretCipher(new Map([['1', Buffer.from(master, 'base64')]]), '1'),
    );
    if (command === 'create-user') {
      await createAdmin(auth);
      return;
    }
    const webRoot = fileURLToPath(
      new URL(import.meta.url.endsWith('.mjs') ? '../web' : '../../../dist/web', import.meta.url),
    );
    await runServer(database, auth, webRoot);
  } finally {
    await database.close();
  }
}
main().catch((error: unknown) => {
  const safe = safeError(error);
  console.error(`${safe.code}: ${safe.safeMessage}`);
  process.exitCode = 1;
});
