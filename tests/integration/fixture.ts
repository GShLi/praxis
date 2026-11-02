import { AuthService, SecretCipher } from '@praxis/auth';
import { PostgresDatabase, migrate } from '@praxis/storage-server';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

export async function databaseFixture() {
  const connection = process.env.PRAXIS_TEST_DATABASE_URL;
  assert.ok(connection, 'Integration tests require an explicit test database connection.');
  const admin = new PostgresDatabase(connection);
  const name = 'praxis_test_' + randomUUID().replaceAll('-', '');
  let database: PostgresDatabase | undefined;
  let created = false;
  const close = async () => {
    try {
      await database?.close();
    } finally {
      try {
        if (created) await admin.query(`DROP DATABASE "${name}"`);
      } finally {
        await admin.close();
      }
    }
  };
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    const url = new URL(connection);
    url.pathname = '/' + name;
    database = new PostgresDatabase(url.href);
    await migrate(database);
    const auth = new AuthService(
      database,
      new SecretCipher(new Map([['1', randomBytes(32)]]), '1'),
    );
    const user = await auth.createUser('fixture-user', 'fixture-password-123');
    const login = await auth.login(user.username, 'fixture-password-123', 'client');
    const identity = await auth.authenticate(login.accessToken);
    return { database, auth, identity, login, close };
  } catch (error) {
    await close();
    throw error;
  }
}
export const provider = {
  name: 'Fixture',
  baseUrl: 'https://provider.invalid',
  model: 'fixture',
  contextWindow: 16000,
  maxOutputTokens: 1000,
  enabled: true,
};
