import { assert } from '@praxis/contracts';
import { createHash } from 'node:crypto';
import type { ServerDatabase } from './types.ts';

export const initialMigration = `
CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', admin BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE auth_sessions(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), token_hash TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, scopes JSONB NOT NULL, expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ, family TEXT NOT NULL, csrf_hash TEXT, consumed BOOLEAN NOT NULL DEFAULT false);
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
CREATE TABLE api_keys(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, secret_hash TEXT NOT NULL, scopes JSONB NOT NULL, expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ, last_used_at TIMESTAMPTZ);
CREATE TABLE provider_configs(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), revision INTEGER NOT NULL, config JSONB NOT NULL, encrypted_key JSONB NOT NULL, enabled BOOLEAN NOT NULL DEFAULT true);
CREATE INDEX provider_configs_user ON provider_configs(user_id);
CREATE TABLE audit_events(id BIGSERIAL PRIMARY KEY, actor TEXT NOT NULL, operation TEXT NOT NULL, resource_id TEXT, outcome TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE chats(id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, latest_seq INTEGER NOT NULL DEFAULT 0, active_generation TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), archived BOOLEAN NOT NULL DEFAULT false);
CREATE INDEX chats_owner ON chats(owner,created_at);
CREATE TABLE chat_events(session_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, seq INTEGER NOT NULL, document JSONB NOT NULL, PRIMARY KEY(session_id,seq));
CREATE TABLE chat_inputs(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, request_id TEXT NOT NULL, digest TEXT NOT NULL, content TEXT NOT NULL, ordinal INTEGER NOT NULL, selected_generation TEXT, UNIQUE(session_id,request_id));
CREATE TABLE chat_generations(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, input_id TEXT NOT NULL REFERENCES chat_inputs(id) ON DELETE CASCADE, status TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', page_id TEXT NOT NULL, lease_hash TEXT NOT NULL, heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX chat_one_active ON chat_generations(session_id) WHERE status='running';
CREATE TABLE chat_contexts(session_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, version INTEGER NOT NULL, summary JSONB NOT NULL, source_ids JSONB NOT NULL, through_input TEXT NOT NULL, valid BOOLEAN NOT NULL DEFAULT true, PRIMARY KEY(session_id,version));
CREATE TABLE chat_requests(session_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, request_id TEXT NOT NULL, digest TEXT NOT NULL, result JSONB NOT NULL, PRIMARY KEY(session_id,request_id));
CREATE TABLE chat_checkpoints(session_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, seq INTEGER NOT NULL, document JSONB NOT NULL, PRIMARY KEY(session_id,seq));
`;

export async function migrate(database: ServerDatabase) {
  await database.transaction(async (sql) => {
    await sql.query('SELECT pg_advisory_xact_lock(707261786973)');
    const instance = await sql.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_xact_lock(707261786974) AS acquired',
    );
    assert(instance.rows[0]?.acquired, 'SERVER_ALREADY_RUNNING', '请先停止服务端再迁移数据库。');
    await sql.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    const migrations = await sql.query<{ version: number; checksum: string }>(
      'SELECT version,checksum FROM schema_migrations ORDER BY version',
    );
    const scripts = [
      initialMigration,
      'CREATE TABLE user_instructions(owner TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, revision INTEGER NOT NULL CHECK(revision>0), document JSONB NOT NULL);',
    ].map((source, index) => ({
      source,
      version: index + 1,
      checksum: createHash('sha256').update(source).digest('hex'),
    }));
    assert(
      migrations.rows.every(
        (r, index) =>
          r.version === scripts[index]?.version && r.checksum === scripts[index]?.checksum,
      ),
      'MIGRATION_CONFLICT',
      '数据库迁移版本或校验和不一致。',
    );
    for (const script of scripts.slice(migrations.rows.length)) {
      await sql.query(script.source);
      await sql.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)', [
        script.version,
        script.checksum,
      ]);
    }
  });
}
