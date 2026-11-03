import { serve } from '@hono/node-server';
import { DiagnosticLog, exportDiagnostics } from '@praxis/diagnostics';
import { createApp } from '@praxis/server/app';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chatFixture } from './chat-fixture.ts';

test('HTTP diagnostics retain status and error classes without paths, request bodies or authentication data', async () => {
  const f = await chatFixture(),
    root = await mkdtemp(path.join(tmpdir(), 'praxis-http-diagnostic-'));
  const log = await DiagnosticLog.open(root),
    origin = 'http://127.0.0.1:4310';
  const server = serve({
    fetch: createApp(f.auth, f.runtime, origin, undefined, undefined, log).fetch,
    hostname: '127.0.0.1',
    port: 0,
  });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(url + '/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ username: f.identity.username, password: 'fixture-password-123' }),
    });
    assert.equal(response.status, 200);
    await response.json();
    assert.equal(
      (
        await fetch(url + '/v1/me?private=secret-query', {
          headers: { authorization: 'Bearer fixture-private-bearer' },
        })
      ).status,
      401,
    );
    await fetch(url + '/private-path-secret');
    await log.flush();
    const report = await exportDiagnostics(root, AbortSignal.timeout(5000));
    assert.ok(report.records.some((record) => record.httpStatus === 200));
    assert.ok(report.records.some((record) => record.httpStatus === 401));
    assert.ok(report.records.some((record) => record.code === 'UNAUTHENTICATED'));
    const json = JSON.stringify(report);
    for (const secret of [
      'fixture-password-123',
      f.identity.username,
      'secret-query',
      'fixture-private-bearer',
      'private-path-secret',
    ])
      assert.ok(!json.includes(secret));
  } finally {
    server.close();
    if ('closeAllConnections' in server) server.closeAllConnections();
    await f.close();
    await log.close();
    await rm(root, { recursive: true, force: true });
  }
});
