import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionStore, uuid } from '../packages/storage-local/src/index.ts';
import { AgentRuntime } from '../packages/agent-runtime/src/index.ts';
import { WorkspaceFiles } from '../packages/tools/src/files.ts';
import { protocolGroups } from '../packages/context/src/index.ts';
import type { ModelClient, ModelRequest, Completion } from '../packages/model-core/src/index.ts';
import type { ModelConfig, ToolCall } from '../packages/contracts/src/index.ts';

const config: ModelConfig = {
  id: 'test',
  revision: 1,
  model: 'fixture',
  baseUrl: 'https://example.invalid',
  apiKey: 'fixture-only',
  contextWindow: 128000,
  maxOutputTokens: 4096,
};
function answer(content: string, toolCalls?: ToolCall[]): Completion {
  return {
    message: { id: uuid(), role: 'assistant', content, ...(toolCalls ? { toolCalls } : {}) },
    usage: { input: 0, output: 0 },
    finishReason: toolCalls ? 'tool_calls' : 'stop',
  };
}
function call(name: string, args: unknown): ToolCall {
  return { id: uuid(), name, arguments: JSON.stringify(args) };
}
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-core-'));
  const store = new SessionStore(path.join(root, 'data', 'sessions.sqlite'));
  const workspace = path.join(root, 'work');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(workspace);
  return {
    root,
    store,
    workspace,
    async close() {
      store.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('multi-turn Agent creates and edits real HTML; duplicate inputs never execute twice', async () => {
  const env = await setup();
  let requests = 0;
  let seenVersion = '';
  const model: ModelClient = {
    async complete(request) {
      requests++;
      const last = request.messages.at(-1)!;
      if (last.role === 'user' && last.content === 'create')
        return answer('', [
          call('fs_write', {
            path: 'index.html',
            mode: 'create',
            content: '<h1>Hello World！！！</h1>\n',
          }),
        ]);
      if (last.role === 'user' && last.content === 'change')
        return answer('', [call('fs_read', { path: 'index.html' })]);
      if (last.role === 'tool') {
        const result = JSON.parse(last.content) as {
          toolId: string;
          data: { fileVersion: string };
        };
        if (result.toolId === 'fs.read') {
          seenVersion = result.data.fileVersion;
          return answer('', [
            call('fs_apply_patch', {
              path: 'index.html',
              expectedVersion: seenVersion,
              edits: [{ oldText: 'Hello World', newText: '你好 Praxis', expectedMatches: 1 }],
            }),
          ]);
        }
      }
      return answer('文件已修改。');
    },
  };
  const runtime = new AgentRuntime(env.store, { model, beginUse: async () => config });
  const session = env.store.create('user', 'agent', env.workspace);
  try {
    const input = { sessionId: session.id, requestId: 'first', mode: 'queue', text: 'create' };
    const accepted = runtime.prompt('user', input);
    assert.deepEqual(runtime.prompt('user', input), accepted);
    await runtime.wait(session.id);
    assert.equal(
      await readFile(path.join(env.workspace, 'index.html'), 'utf8'),
      '<h1>Hello World！！！</h1>\n',
    );
    runtime.prompt('user', { ...input, requestId: 'second', text: 'change' });
    await runtime.wait(session.id);
    assert.equal(
      await readFile(path.join(env.workspace, 'index.html'), 'utf8'),
      '<h1>你好 Praxis！！！</h1>\n',
    );
    assert.equal(env.store.get(session.id).status, 'completed');
    assert.equal(requests, 5);
    assert.ok(seenVersion);
    assert.equal(env.store.messages(session.id).filter((m) => m.role === 'user').length, 2);
    assert.doesNotThrow(() => protocolGroups(env.store.messages(session.id)));
    assert.throws(() => runtime.prompt('user', { ...input, text: 'different' }), /requestId/);
    assert.throws(() => env.store.get(session.id, 'other'), /不存在/);
  } finally {
    await runtime.close();
    await env.close();
  }
});
test('partial reads cannot replace whole files; stale versions and patch mismatches preserve bytes', async () => {
  const env = await setup();
  const session = env.store.create('u', 'agent', env.workspace);
  const files = await WorkspaceFiles.open(env.workspace, (kind, content) =>
    env.store.artifact(session.id, kind, content),
  );
  const signal = new AbortController().signal;
  try {
    await writeFile(path.join(env.workspace, 'a.txt'), 'first\r\nsecond\r\n');
    const first = await files.read({ path: 'a.txt', startLine: 1, lineCount: 1 });
    await assert.rejects(
      files.write(
        { path: 'a.txt', mode: 'replace', content: 'bad', expectedVersion: first.fileVersion },
        signal,
      ),
      /未完整读取/,
    );
    const full = await files.read({ path: 'a.txt', startLine: 1, lineCount: 20 });
    await assert.rejects(
      files.patch(
        {
          path: 'a.txt',
          expectedVersion: full.fileVersion,
          edits: [{ oldText: 'first', newText: 'changed', expectedMatches: 2 }],
        },
        signal,
      ),
      /匹配数量/,
    );
    assert.equal(await readFile(path.join(env.workspace, 'a.txt'), 'utf8'), 'first\r\nsecond\r\n');
    await writeFile(path.join(env.workspace, 'a.txt'), 'external');
    await assert.rejects(
      files.write(
        { path: 'a.txt', mode: 'replace', content: 'bad', expectedVersion: full.fileVersion },
        signal,
      ),
      /文件已变化/,
    );
    await assert.rejects(
      files.write({ path: 'a.txt', mode: 'create', content: 'bad' }, signal),
      /已存在/,
    );
    await assert.rejects(
      files.read({ path: '../data/sessions.sqlite', startLine: 1, lineCount: 1 }),
      /工作区/,
    );
    await symlink(
      path.join(env.root, 'data'),
      path.join(env.workspace, 'escape'),
      process.platform === 'win32' ? 'junction' : undefined,
    );
    await assert.rejects(
      files.read({ path: 'escape/sessions.sqlite', startLine: 1, lineCount: 1 }),
      /读取范围/,
    );
  } finally {
    await env.close();
  }
});
test('Chat carries no tools and refuses unsolicited tool calls', async () => {
  const env = await setup();
  const runtime = new AgentRuntime(env.store, {
    model: {
      async complete(request) {
        assert.equal(request.tools.length, 0);
        return answer('', [call('fs_write', { path: 'bad', mode: 'create', content: 'bad' })]);
      },
    },
    beginUse: async () => config,
  });
  const session = env.store.create('u', 'chat');
  try {
    runtime.prompt('u', { sessionId: session.id, requestId: uuid(), text: 'create' });
    await runtime.wait(session.id);
    assert.equal(env.store.get(session.id).status, 'failed');
    assert.ok(env.store.events(session.id).some((e) => e.payload.code === 'UNEXPECTED_TOOL_CALL'));
  } finally {
    await runtime.close();
    await env.close();
  }
});
test('cancel interrupts a pending model and suspends queued inputs', async () => {
  const env = await setup();
  let began!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  const runtime = new AgentRuntime(env.store, {
    model: {
      complete(request: ModelRequest) {
        began();
        return new Promise<Completion>((_, reject) => {
          request.signal.addEventListener(
            'abort',
            () => reject(new DOMException('Cancelled', 'AbortError')),
            { once: true },
          );
        });
      },
    },
    beginUse: async () => config,
  });
  const session = env.store.create('u', 'agent', env.workspace);
  try {
    runtime.prompt('u', { sessionId: session.id, requestId: uuid(), text: 'wait' });
    await started;
    runtime.prompt('u', { sessionId: session.id, requestId: uuid(), text: 'queued' });
    runtime.cancel('u', session.id, runtime.getTurn(session.id));
    await runtime.wait(session.id);
    assert.equal(env.store.get(session.id).status, 'cancelled');
    assert.equal(env.store.inputs(session.id, 'suspended').length, 1);
  } finally {
    await runtime.close();
    await env.close();
  }
});
test('recovery closes unknown tool groups without executing effects and retains history', async () => {
  const env = await setup();
  try {
    const session = env.store.create('u', 'agent', env.workspace);
    env.store.update(session.id, { status: 'running' });
    env.store.message(
      session.id,
      answer('', [call('process_exec', { executable: 'never-run' })]).message,
    );
    env.store.recover();
    assert.equal(env.store.get(session.id).status, 'interrupted');
    const messages = env.store.messages(session.id);
    assert.equal(messages.length, 2);
    assert.equal(JSON.parse(messages[1]!.content).effectState, 'unknown');
    assert.doesNotThrow(() => protocolGroups(messages));
    env.store.recover();
    assert.equal(env.store.messages(session.id).length, 2);
  } finally {
    await env.close();
  }
});
test('events are emitted after commit; rollback publishes nothing', async () => {
  const env = await setup();
  try {
    const session = env.store.create('u', 'chat');
    const seen: number[] = [];
    env.store.on('event', (e) => seen.push(e.seq));
    assert.throws(() =>
      env.store.transaction(() => {
        env.store.append(session.id, 'test', {});
        throw new Error('fail');
      }),
    );
    assert.deepEqual(seen, []);
    assert.equal(env.store.get(session.id).latestSeq, 1);
    env.store.append(session.id, 'test', {});
    assert.deepEqual(seen, [2]);
  } finally {
    await env.close();
  }
});

test('private application data and linked aliases remain protected inside a parent workspace', async () => {
  const { mkdir, link } = await import('node:fs/promises');
  const env = await setup();
  try {
    const privateRoot = path.join(env.workspace, 'Application Support', 'Praxis');
    await mkdir(privateRoot, { recursive: true });
    await writeFile(path.join(privateRoot, 'secret.txt'), 'fixture only');
    await symlink(privateRoot, path.join(env.workspace, 'shortcut'), 'junction');
    await link(path.join(privateRoot, 'secret.txt'), path.join(env.workspace, 'alias.txt'));
    const files = await WorkspaceFiles.open(env.workspace, () => 'artifact', [privateRoot]);
    for (const name of [
      'Application Support/Praxis/secret.txt',
      'shortcut/secret.txt',
      'alias.txt',
      'report.txt:secret',
      'NUL',
    ]) {
      await assert.rejects(
        files.read({ path: name, startLine: 1, lineCount: 10 }),
        (e: unknown) => (e as { code: string }).code === 'ACCESS_DENIED',
      );
    }
    await assert.rejects(
      WorkspaceFiles.open(privateRoot, () => '', [privateRoot]),
      /内部目录/,
    );
  } finally {
    await env.close();
  }
});

test('file publishing rechecks user permissions after asynchronous preparation', async () => {
  const env = await setup();
  let writes = 0;
  try {
    const files = await WorkspaceFiles.open(
      env.workspace,
      () => 'artifact',
      [],
      () => {
        if (++writes > 1) throw new Error('permission revoked');
      },
    );
    await assert.rejects(
      files.write(
        { path: 'revoked.txt', mode: 'create', content: 'must not publish', createParents: false },
        new AbortController().signal,
      ),
      /permission revoked/,
    );
    await assert.rejects(readFile(path.join(env.workspace, 'revoked.txt')), { code: 'ENOENT' });
  } finally {
    await env.close();
  }
});
