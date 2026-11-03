import { AgentRuntime } from '@praxis/agent-runtime';
import { AuthClient } from '@praxis/auth-client';
import { PraxisError, safeError } from '@praxis/contracts';
import { DeepSeekClient, type ModelClient } from '@praxis/model-core';
import { SessionStore } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Opt-in real provider test: existing Praxis login, at most 7 sends, private disposable data. */
async function main() {
  const file = process.argv[2];
  assert(file, 'Pass the path of the local Praxis login JSON, never a Key in argv.');
  const login: { serverUrl: string; praxisApiKey: string } = JSON.parse(await readLogin(file));
  const auth = new AuthClient(login.serverUrl);
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-live-model-'));
  const store = new SessionStore(path.join(root, 'sessions.sqlite'));
  const client = new DeepSeekClient();
  let sends = 0;
  const charge = () => {
    if (sends >= 7) throw new PraxisError('TEST_BUDGET_EXHAUSTED', '真实测试已达到 7 次请求上限。');
    sends++;
  };
  const model: ModelClient = {
    complete(request) {
      charge();
      return client.complete({
        ...request,
        beforeRetry: () => {
          charge();
          request.beforeRetry?.();
        },
      });
    },
  };
  const runtime = new AgentRuntime(store, {
    model,
    beginUse: async (_owner, signal) => ({
      ...(await auth.beginUse(undefined, signal)),
      maxOutputTokens: 1024,
    }),
    maxSteps: 4,
    maxAttempts: 4,
    maxTools: 4,
    timeoutMs: 60000,
  });
  try {
    await auth.bind(login.praxisApiKey, AbortSignal.timeout(15000));
    const configured = (await auth.providers(AbortSignal.timeout(15000))).find((p) => p.enabled);
    console.log(JSON.stringify({ phase: 'configured', model: configured?.model, maxSends: 7 }));
    await exercise(runtime, auth.userId, root);
    console.log(
      JSON.stringify({ phase: 'passed', sends, scenarios: ['chat', 'create-html', 'modify-html'] }),
    );
  } finally {
    await runtime.close();
    store.close();
    await auth.clear();
    await rm(root, { recursive: true, force: true });
  }
}

async function readLogin(file: string) {
  if (file !== '-') return readFile(file, 'utf8');
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk.toString();
    assert(Buffer.byteLength(input) <= 16384, 'Test login input is too large.');
  }
  return input;
}

async function exercise(runtime: AgentRuntime, owner: string, root: string) {
  const prompt = async (id: string, text: string) => {
    runtime.prompt(owner, { sessionId: id, requestId: crypto.randomUUID(), mode: 'queue', text });
    await runtime.wait(id);
    const session = runtime.store.get(id);
    if (session.status !== 'completed') {
      const error = runtime.store.events(id, 0, 500).findLast((e) => e.type === 'turn/finished');
      console.log(
        JSON.stringify({ phase: 'failed-turn', status: session.status, outcome: error?.payload }),
      );
      throw new PraxisError('LIVE_TEST_FAILED', '真实模型任务未完成。');
    }
  };
  const chat = await runtime.create(owner, 'chat');
  await prompt(chat.id, '这是一项连通性测试，请只回复：Praxis OK');
  assert.match(runtime.store.messages(chat.id).at(-1)?.content ?? '', /Praxis OK/);
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  const agent = await runtime.create(owner, 'agent', workspace);
  await prompt(
    agent.id,
    '这是隔离测试目录。仅用 fs_write 创建 index.html，内容必须精确为 <h1>Hello World！！！</h1>。不要执行命令，不需要检查其他文件，完成后简短回答。',
  );
  assert.equal(
    (await readFile(path.join(workspace, 'index.html'), 'utf8')).trim(),
    '<h1>Hello World！！！</h1>',
  );
  await prompt(
    agent.id,
    '继续同一任务：先用 fs_read 读取 index.html 获取版本，再用 fs_apply_patch 把 Hello World 替换成 你好 Praxis，保留其他内容。不要执行命令，完成后简短回答。',
  );
  assert.equal(
    (await readFile(path.join(workspace, 'index.html'), 'utf8')).trim(),
    '<h1>你好 Praxis！！！</h1>',
  );
}

main().catch((error: unknown) => {
  console.error(JSON.stringify(safeError(error)));
  process.exitCode = 1;
});
