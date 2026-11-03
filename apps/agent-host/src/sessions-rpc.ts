import { assert, idSchema, permissionSchema } from '@praxis/contracts';
import { approvalResponseSchema } from '@praxis/permissions';
import { hash } from '@praxis/storage-local';
import { realpath, stat } from 'node:fs/promises';
import { z } from 'zod';
import type { HostIdentity } from './identity.ts';
import type { RpcRoutes } from './rpc-schema.ts';
import { noArgs, sessionArg } from './rpc-schema.ts';
export function sessionsRoutes(
  identity: HostIdentity,
  clientKind: () => 'cli' | 'desktop',
): RpcRoutes {
  return {
    'workspace/open': async (params: unknown) => {
      identity.require();
      const input = z.strictObject({ path: z.string().min(1).max(4096) }).parse(params);
      const root = await realpath(input.path);
      assert((await stat(root)).isDirectory(), 'INVALID_WORKSPACE', '工作区必须是目录。');
      const id = hash(root);
      identity.workspaces.set(id, root);
      return { id, canonicalRoot: root };
    },
    'session/create': async (params: unknown) => {
      const { store, owner } = identity.require();
      const input = z
        .strictObject({ kind: z.enum(['agent', 'chat']), workspaceId: idSchema.optional() })
        .parse(params);
      assert(
        input.kind !== 'chat' || clientKind() === 'desktop',
        'MODE_UNAVAILABLE',
        'CLI 只支持 Agent。',
      );
      const workspace = input.workspaceId ? identity.workspaces.get(input.workspaceId) : undefined;
      return store.create(owner, input.kind, workspace);
    },
    'session/list': async (params: unknown) => {
      const { store, owner } = identity.require();
      noArgs.parse(params);
      return store.list(owner);
    },
    'session/read': async (params: unknown) => {
      const { store, runtime, owner } = identity.require();
      const input = sessionArg.parse(params);
      const session = store.get(input.sessionId, owner);
      return {
        session,
        messages: store.timeline(session.id),
        suspended: store.inputs(session.id, 'suspended'),
        contextVersion: store.context(session.id).version,
        throughSeq: session.latestSeq,
        turnId: runtime.getTurn(session.id) ?? null,
        question: runtime.pendingQuestion(session.id),
        approval: runtime.approvals.snapshot(session.id),
      };
    },
    'session/prompt': async (params: unknown) => {
      const { runtime, owner } = identity.require();
      assert(
        !identity.pluginsChanged,
        'HOST_RESTART_REQUIRED',
        '插件配置已变化，请重新登录或重启客户端后开始任务。',
      );
      return runtime.prompt(owner, params);
    },
    'session/continue': async (params: unknown) => {
      const { runtime, owner } = identity.require();
      assert(
        !identity.pluginsChanged,
        'HOST_RESTART_REQUIRED',
        '插件配置已变化，请重新登录或重启客户端后开始任务。',
      );
      return runtime.prompt(owner, params);
    },
    'session/cancel': async (params: unknown) => {
      const { runtime, owner } = identity.require();
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
    },
    'session/subscribe': async (params: unknown) => {
      const { store, owner } = identity.require();
      const input = z
        .strictObject({ sessionId: idSchema, afterSeq: z.number().int().nonnegative().default(0) })
        .parse(params);
      const session = store.get(input.sessionId, owner);
      assert(input.afterSeq <= session.latestSeq, 'INVALID_CURSOR', '事件游标超出范围。');
      identity.subscriptions.set(session.id, input.afterSeq);
      return { subscribed: true };
    },
    'session/unsubscribe': async (params: unknown) => {
      const { store, owner } = identity.require();
      const input = sessionArg.parse(params);
      store.get(input.sessionId, owner);
      identity.subscriptions.delete(input.sessionId);
      return { ok: true };
    },
    'session/set-permissions': async (params: unknown) => {
      const { store, runtime, owner } = identity.require();
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
      const result = store.transaction(() => {
        const value = { ...input.permission, revision: input.expectedRevision + 1 };
        store!.update(session.id, { permission: value });
        store!.append(session.id, 'permission/changed', { permission: value }, 'user');
        return value;
      });
      runtime.approvals.invalidate(session.id);
      return result;
    },
    'question/respond': async (params: unknown) => {
      const { runtime, owner } = identity.require();
      const input = z
        .strictObject({
          sessionId: idSchema,
          questionId: idSchema,
          turnId: idSchema,
          answers: z.unknown(),
        })
        .parse(params);
      return runtime.answer(owner, { ...input, answers: input.answers });
    },
    'approval/respond': async (params: unknown) => {
      const { runtime, owner } = identity.require();
      return runtime.approvals.respond(owner, approvalResponseSchema.parse(params));
    },
    'session/archive': async (params: unknown) => {
      const { store, runtime, owner } = identity.require();
      const input = sessionArg.parse(params);
      store.get(input.sessionId, owner);
      assert(!runtime.getTurn(input.sessionId), 'SESSION_BUSY', '请先停止当前任务。');
      return store.update(input.sessionId, { archived: true });
    },
    'session/delete': async (params: unknown) => {
      const { store, runtime, owner } = identity.require();
      const input = sessionArg.parse(params);
      store.get(input.sessionId, owner);
      runtime.cancel(owner, input.sessionId);
      await runtime.wait(input.sessionId);
      identity.subscriptions.delete(input.sessionId);
      store.delete(input.sessionId);
      return { ok: true };
    },
    'artifact/read': async (params: unknown) => {
      const { store, owner } = identity.require();
      const input = z.strictObject({ sessionId: idSchema, artifactId: idSchema }).parse(params);
      store.get(input.sessionId, owner);
      return store.readArtifact(input.sessionId, input.artifactId);
    },
  };
}
