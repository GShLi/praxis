import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { homedir } from 'node:os';
import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { z } from 'zod';
import {
  initializeSchema,
  PROTOCOL,
  assert,
  PraxisError,
  idSchema,
  permissionSchema,
} from '../../../packages/contracts/src/index.ts';
import { JsonLines, serveRpc } from '../../../packages/transport/src/index.ts';
import { SessionStore, hash } from '../../../packages/storage-local/src/index.ts';
import { AgentRuntime } from '../../../packages/agent-runtime/src/index.ts';
import { DeepSeekClient } from '../../../packages/model-core/src/index.ts';
import { AuthClient } from '../../../packages/auth-client/src/index.ts';
import { acquireLease } from '../../../packages/workspace/src/index.ts';
import { providerInputSchema } from '../../../packages/auth/src/index.ts';

const channel = new JsonLines(process.stdin, process.stdout);
const instanceId = randomUUID();
let initialized = false,
  clientKind: 'cli' | 'desktop' = 'cli',
  lastHeartbeat = performance.now(),
  closing = false,
  binding = false;
let auth: AuthClient | undefined,
  store: SessionStore | undefined,
  runtime: AgentRuntime | undefined;
let dataLease: Awaited<ReturnType<typeof acquireLease>> | undefined;
let selectedProvider: string | undefined;
const workspaces = new Map<string, string>();
const subscriptions = new Map<string, number>();
const noArgs = z.strictObject({});
const sessionArg = z.strictObject({ sessionId: idSchema });
const baseData =
  process.env.PRAXIS_DATA_DIR ??
  (process.platform === 'darwin'
    ? path.join(homedir(), 'Library', 'Application Support', 'Praxis')
    : process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA ?? homedir(), 'Praxis')
      : path.join(process.env.XDG_DATA_HOME ?? path.join(homedir(), '.local', 'share'), 'praxis'));
function notify(method: string, params: unknown) {
  try {
    channel.send({ jsonrpc: '2.0', method, params });
  } catch {
    void shutdown();
  }
}
async function clearIdentity() {
  subscriptions.clear();
  await runtime?.close();
  runtime = undefined;
  store?.close();
  store = undefined;
  await dataLease?.release();
  dataLease = undefined;
  await auth?.clear();
  auth = undefined;
  workspaces.clear();
}
async function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(watchdog);
  clearInterval(publisher);
  const deadline = setTimeout(() => process.exit(1), 4500);
  await clearIdentity();
  channel.close();
  process.stdin.pause();
  clearTimeout(deadline);
  process.stdout.end(() => process.exit(0));
}
const watchdog = setInterval(() => {
  if (performance.now() - lastHeartbeat > 15_000 || process.ppid === 1) void shutdown();
}, 1000);
const publisher = setInterval(() => {
  if (!store || closing) return;
  for (const [id, cursor] of subscriptions) {
    for (const event of store.events(id, cursor, 100)) {
      notify('session/event', event);
      subscriptions.set(id, event.seq);
    }
  }
}, 100);
channel.on('close', () => {
  void shutdown();
});
process.once('SIGTERM', () => {
  void shutdown();
});
process.once('SIGINT', () => {
  void shutdown();
});
serveRpc(channel, async (method, params) => {
  if (method === 'host/initialize') {
    assert(!initialized, 'ALREADY_INITIALIZED', 'Host 已初始化。');
    const input = initializeSchema.parse(params);
    assert(input.protocolMajor === PROTOCOL.major, 'PROTOCOL_MISMATCH', 'Host 协议主版本不兼容。');
    initialized = true;
    clientKind = input.clientKind;
    lastHeartbeat = performance.now();
    return {
      ...PROTOCOL,
      hostInstanceId: instanceId,
      nonce: input.nonce,
      capabilities: ['sessions', 'files', 'context', 'questions', 'chat'],
      storageVersion: 1,
    };
  }
  assert(initialized && !closing, 'NOT_INITIALIZED', 'Host 尚未初始化或正在退出。');
  if (method === 'host/ping') {
    noArgs.parse(params);
    lastHeartbeat = performance.now();
    return { ok: true };
  }
  if (method === 'host/shutdown') {
    noArgs.parse(params);
    setImmediate(() => {
      void shutdown();
    });
    return { accepted: true };
  }
  if (method === 'host/diagnostics') {
    noArgs.parse(params);
    return {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      protocol: PROTOCOL,
      agentAvailable: Boolean(auth),
      commandExecution: 'unavailable: native isolation not yet verified',
      authenticated: Boolean(auth),
    };
  }
  if (method === 'auth/bind') {
    assert(!binding, 'AUTH_BUSY', '身份切换正在进行。');
    const input = z
      .strictObject({
        serverUrl: z.string().url(),
        praxisApiKey: z.string().max(1024),
        providerId: idSchema.optional(),
        interactive: z.boolean().default(false),
      })
      .parse(params);
    binding = true;
    try {
      await clearIdentity();
      const candidate = new AuthClient(input.serverUrl);
      await candidate.bind(input.praxisApiKey, AbortSignal.timeout(15_000));
      assert(!closing, 'HOST_CLOSING', 'Host 正在退出。');
      const directory = path.join(baseData, clientKind, hash(candidate.userId));
      dataLease = await acquireLease(path.join(directory, 'writer.lock'));
      dataLease.onLost(() => {
        void shutdown();
      });
      auth = candidate;
      store = new SessionStore(path.join(directory, 'sessions.sqlite'));
      store.recover();
      selectedProvider = input.providerId;
      runtime = new AgentRuntime(store, {
        model: new DeepSeekClient(),
        interactive: input.interactive,
        beginUse: (_owner, signal) => candidate.beginUse(selectedProvider, signal),
        acquireWorkspace: async (root, signal) => {
          signal.throwIfAborted();
          const info = await stat(root);
          return acquireLease(
            path.join(
              baseData,
              'workspace-locks',
              hash(
                `${info.dev}:${info.ino}:${process.platform === 'win32' ? root.toLowerCase() : ''}`,
              ) + '.lock',
            ),
          );
        },
      });
      runtime.on('delta', (delta) => notify('session/delta', delta));
      runtime.on('fatal', () => {
        void shutdown();
      });
      return { userId: candidate.userId };
    } catch (error) {
      await clearIdentity();
      throw error;
    } finally {
      binding = false;
    }
  }
  if (method === 'auth/clear') {
    noArgs.parse(params);
    assert(!binding, 'AUTH_BUSY', '身份切换正在进行。');
    await clearIdentity();
    return { ok: true };
  }
  assert(auth && store && runtime && !binding, 'UNAUTHENTICATED', '请先使用 Praxis 身份登录。');
  const owner = auth.userId;
  if (method === 'provider/list') {
    noArgs.parse(params);
    return auth.providers(AbortSignal.timeout(15_000));
  }
  if (method === 'provider/select') {
    const input = z.strictObject({ providerId: idSchema }).parse(params);
    selectedProvider = input.providerId;
    return { ok: true };
  }
  if (method === 'provider/save') {
    const input = z
      .strictObject({
        config: providerInputSchema,
        apiKey: z.string().min(1).max(4096).optional(),
        id: idSchema.optional(),
        expectedRevision: z.number().int().positive().optional(),
      })
      .parse(params);
    return auth.saveProvider(
      {
        config: input.config,
        ...(input.apiKey ? { apiKey: input.apiKey } : {}),
        ...(input.id ? { id: input.id, expectedRevision: input.expectedRevision! } : {}),
      },
      AbortSignal.timeout(15_000),
    );
  }
  if (method === 'workspace/open') {
    const input = z.strictObject({ path: z.string().min(1).max(4096) }).parse(params);
    const root = await realpath(input.path);
    assert((await stat(root)).isDirectory(), 'INVALID_WORKSPACE', '工作区必须是目录。');
    const id = hash(root);
    workspaces.set(id, root);
    return { id, canonicalRoot: root };
  }
  if (method === 'session/create') {
    const input = z
      .strictObject({ kind: z.enum(['agent', 'chat']), workspaceId: idSchema.optional() })
      .parse(params);
    assert(
      input.kind !== 'chat' || clientKind === 'desktop',
      'MODE_UNAVAILABLE',
      'CLI 只支持 Agent。',
    );
    const workspace = input.workspaceId ? workspaces.get(input.workspaceId) : undefined;
    return store.create(owner, input.kind, workspace);
  }
  if (method === 'session/list') {
    noArgs.parse(params);
    return store.list(owner);
  }
  if (method === 'session/read') {
    const input = sessionArg.parse(params);
    const session = store.get(input.sessionId, owner);
    return {
      session,
      messages: store.messages(session.id),
      suspended: store.inputs(session.id, 'suspended'),
      contextVersion: store.context(session.id).version,
      throughSeq: session.latestSeq,
      turnId: runtime.getTurn(session.id) ?? null,
      question: runtime.pendingQuestion(session.id),
    };
  }
  if (method === 'session/prompt' || method === 'session/continue')
    return runtime.prompt(owner, params);
  if (method === 'session/cancel') {
    const input = z
      .strictObject({
        sessionId: idSchema,
        expectedTurnId: idSchema.optional(),
        pendingDisposition: z.enum(['keep_suspended', 'cancel']).default('keep_suspended'),
      })
      .parse(params);
    return runtime.cancel(
      owner,
      input.sessionId,
      input.expectedTurnId,
      input.pendingDisposition === 'cancel',
    );
  }
  if (method === 'session/subscribe') {
    const input = z
      .strictObject({ sessionId: idSchema, afterSeq: z.number().int().nonnegative().default(0) })
      .parse(params);
    const session = store.get(input.sessionId, owner);
    assert(input.afterSeq <= session.latestSeq, 'INVALID_CURSOR', '事件游标超出范围。');
    subscriptions.set(session.id, input.afterSeq);
    return { subscribed: true };
  }
  if (method === 'session/unsubscribe') {
    const input = sessionArg.parse(params);
    store.get(input.sessionId, owner);
    subscriptions.delete(input.sessionId);
    return { ok: true };
  }
  if (method === 'session/set-permissions') {
    const input = z
      .strictObject({
        sessionId: idSchema,
        expectedRevision: z.number().int().nonnegative(),
        permission: permissionSchema,
      })
      .parse(params);
    const session = store.get(input.sessionId, owner);
    assert(
      session.kind === 'agent' && session.permission.revision === input.expectedRevision,
      'POLICY_CONFLICT',
      '权限版本冲突或会话类型不支持。',
    );
    return store.transaction(() => {
      const value = { ...input.permission, revision: input.expectedRevision + 1 };
      store!.update(session.id, { permission: value });
      store!.append(session.id, 'permission/changed', { permission: value }, 'user');
      return value;
    });
  }
  if (method === 'question/respond') {
    const input = z
      .strictObject({
        sessionId: idSchema,
        questionId: idSchema,
        turnId: idSchema,
        answers: z.unknown(),
      })
      .parse(params);
    return runtime.answer(owner, { ...input, answers: input.answers });
  }
  if (method === 'session/archive') {
    const input = sessionArg.parse(params);
    store.get(input.sessionId, owner);
    assert(!runtime.getTurn(input.sessionId), 'SESSION_BUSY', '请先停止当前任务。');
    return store.update(input.sessionId, { archived: true });
  }
  if (method === 'session/delete') {
    const input = sessionArg.parse(params);
    store.get(input.sessionId, owner);
    runtime.cancel(owner, input.sessionId);
    await runtime.wait(input.sessionId);
    subscriptions.delete(input.sessionId);
    store.delete(input.sessionId);
    return { ok: true };
  }
  if (method === 'artifact/read') {
    const input = z.strictObject({ sessionId: idSchema, artifactId: idSchema }).parse(params);
    store.get(input.sessionId, owner);
    return store.readArtifact(input.sessionId, input.artifactId);
  }
  throw new PraxisError('METHOD_NOT_FOUND', '此 Host 不支持该方法。');
});
