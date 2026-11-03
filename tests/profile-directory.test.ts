import { bindLegacyProfile, profilePaths, resolveProfileDirectory } from '@praxis/config/profile';
import { SessionStore } from '@praxis/storage-local';
import { acquireLease } from '@praxis/workspace';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const alice = { userId: 'alice', clientKind: 'cli' as const, serverUrl: 'https://praxis.example' };

test('profile paths bind canonical origin, user and client kind', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-profiles-'));
  try {
    const expected = profilePaths(root, alice).current;
    assert.equal(
      await resolveProfileDirectory(root, { ...alice, serverUrl: 'https://PRAXIS.example:443/' }),
      expected,
    );
    for (const other of [
      { ...alice, userId: 'bob' },
      { ...alice, clientKind: 'desktop' as const },
      { ...alice, serverUrl: 'https://other.example' },
    ])
      assert.notEqual(await resolveProfileDirectory(root, other), expected);
    assert.throws(
      () => profilePaths(root, { ...alice, serverUrl: 'https://user:secret@praxis.example' }),
      { code: 'INVALID_SERVER_URL' },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy binding requires confirmation, preserves records and never assigns history to another origin', async () => {
  const f = await legacyProfile();
  const other = { ...alice, serverUrl: 'https://other.example' };
  try {
    for (const identity of [alice, other])
      await assert.rejects(resolveProfileDirectory(f.root, identity), {
        code: 'PROFILE_BINDING_REQUIRED',
      });
    await assert.rejects(bindLegacyProfile(f.root, alice, other.serverUrl, f.signal), {
      code: 'PROFILE_CONFIRM_REQUIRED',
    });
    const result = await bindLegacyProfile(f.root, alice, alice.serverUrl, f.signal);
    assert.equal(result.directory, f.paths.legacy);
    assert.equal(await resolveProfileDirectory(f.root, alice), f.paths.legacy);
    assert.equal(await resolveProfileDirectory(f.root, other), profilePaths(f.root, other).current);
    await assert.rejects(bindLegacyProfile(f.root, other, other.serverUrl, f.signal), {
      code: 'PROFILE_ALREADY_BOUND',
    });
    assert.deepEqual(await bindLegacyProfile(f.root, alice, alice.serverUrl, f.signal), result);
    const store = new SessionStore(path.join(f.paths.legacy, 'sessions.sqlite'));
    try {
      assert.equal(store.list('alice')[0]?.title, 'Keep my history');
    } finally {
      store.close();
    }
    const marker = path.join(f.paths.legacy, 'profile-origin.json');
    assert.equal(JSON.parse(await readFile(marker, 'utf8')).serverUrl, alice.serverUrl);
    if (process.platform !== 'win32') assert.equal((await stat(marker)).mode & 0o777, 0o600);
  } finally {
    await f.close();
  }
});

test('cancelled or corrupted legacy binding cannot silently claim old data', async () => {
  const f = await legacyProfile();
  try {
    await assert.rejects(bindLegacyProfile(f.root, alice, alice.serverUrl, AbortSignal.abort()));
    await assert.rejects(resolveProfileDirectory(f.root, alice), {
      code: 'PROFILE_BINDING_REQUIRED',
    });
    await writeFile(path.join(f.paths.legacy, 'profile-origin.json'), '{broken');
    await assert.rejects(resolveProfileDirectory(f.root, alice), {
      code: 'PROFILE_BINDING_INVALID',
    });
    await assert.rejects(bindLegacyProfile(f.root, alice, alice.serverUrl, f.signal), {
      code: 'PROFILE_BINDING_INVALID',
    });
    assert.equal(
      await readFile(path.join(f.paths.legacy, 'profile-origin.json'), 'utf8'),
      '{broken',
    );
  } finally {
    await f.close();
  }
});

async function legacyProfile() {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-legacy-'));
  const paths = profilePaths(root, alice),
    store = new SessionStore(path.join(paths.legacy, 'sessions.sqlite'));
  const session = store.create('alice', 'chat');
  store.update(session.id, { title: 'Keep my history' });
  store.close();
  const lease = await acquireLease(path.join(paths.legacy, 'writer.lock'));
  return {
    root,
    paths,
    signal: AbortSignal.timeout(10000),
    async close() {
      await lease.release();
      await rm(root, { recursive: true, force: true });
    },
  };
}
