import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createShowcaseClient, demoRestriction } from './fixtures/showcase/client.ts';
import { showcaseScenes } from './fixtures/showcase/scenes.ts';
import { completedId, approvalId } from './fixtures/showcase/agent.ts';

test('eight fictional sessions expose navigable scenes and isolated snapshots', async () => {
  const client = createShowcaseClient();
  const sessions = await client.list();
  assert.equal(sessions.length, 8);
  assert.equal(new Set(sessions.map((session) => session.id)).size, 8);
  for (const scene of showcaseScenes) {
    if (!('sessionId' in scene)) continue;
    const snapshot = await client.read(scene.sessionId);
    assert.equal(snapshot.session.title, scene.buttonText);
    assert.ok(snapshot.messages.some((message) => message.role === 'assistant'));
  }
  sessions[0]!.title = 'changed';
  const first = await client.read('showcase-chat');
  first.messages.length = 0;
  assert.equal((await client.list())[0]!.title, '山岚工作室 · 官网策划');
  assert.equal((await client.read('showcase-chat')).messages.length, 6);
  const web = createShowcaseClient({ desktop: false });
  assert.equal((await web.list()).length, 6);
  await assert.rejects(web.read(completedId), /演示会话不存在/);
});

test('completed task file links resolve to historical diffs within their session', async () => {
  const client = createShowcaseClient();
  const snapshot = await client.read(completedId);
  assert.equal(snapshot.session.status, 'completed');
  assert.equal(snapshot.events?.at(-1)?.type, 'turn/finished');
  const results = snapshot.messages.filter((message) => message.role === 'tool');
  assert.equal(results.length, 4);
  for (const id of ['showcase-grid-diff', 'showcase-content-diff']) {
    const artifact = await client.readArtifact!(completedId, id);
    assert.equal(artifact.kind, 'file-change');
    const change = JSON.parse(artifact.content);
    assert.notEqual(change.before, change.after);
    assert.match(change.path, /^src\//);
    await assert.rejects(client.readArtifact!(approvalId, id), /没有此文件变更/);
  }
  await assert.rejects(client.readArtifact!(completedId, 'unknown'), /没有此文件变更/);
});

test('configuration states are synthetic and writes or approvals cannot execute', async () => {
  const client = createShowcaseClient();
  const before = await client.read(approvalId);
  const request = before.approval!;
  const providers = await client.providers();
  assert.equal(providers.length, 3);
  assert.ok(providers.every((provider) => (provider.models?.length ?? 0) >= 2));
  assert.ok(providers.every((provider) => provider.baseUrl.includes('.example.invalid/')));
  assert.equal((await client.mcpServers!()).value.length, 2);
  for (const operation of [
    () => client.send(approvalId, 'run', providers[0]!.id, 'queue', before.turnId),
    () => client.create('agent', '/demo/shanlan-studio'),
    () => client.cancel(approvalId),
    () =>
      client.respondApproval!({
        sessionId: approvalId,
        turnId: request.turnId,
        approvalId: request.approvalId,
        requestHash: request.requestHash,
        decision: 'approve-once',
      }),
    () => client.saveProvider({ config: providers[0]! }),
    () => client.testMcp!('showcase-design-library', 1),
    () => client.saveMcp!({}, 1, null),
    () => client.setPermissions!(approvalId, 1, 'workspace-write'),
  ]) {
    await assert.rejects(operation(), (error: Error) => error.message === demoRestriction);
  }
  assert.deepEqual(await client.read(approvalId), before);
  let emitted = false;
  const off = client.listen(
    approvalId,
    0,
    () => {
      emitted = true;
    },
    () => {
      emitted = true;
    },
    () => {
      emitted = true;
    },
  );
  off();
  off();
  assert.equal(emitted, false);
});

test('the real App entry bundles for a browser without creating repository output', async () => {
  const bundled = await build({
    entryPoints: ['tests/fixtures/showcase/entry.tsx'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    outfile: '/showcase-memory/entry.js',
    write: false,
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  assert.ok(bundled.outputFiles.some((file) => file.path.endsWith('.js')));
  assert.ok(bundled.outputFiles.some((file) => file.path.endsWith('.css')));
});
