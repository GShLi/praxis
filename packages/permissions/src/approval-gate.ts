import { fingerprint } from '@praxis/config';
import { assert, PraxisError } from '@praxis/contracts';
import { SessionStore, uuid } from '@praxis/storage-local';
import { approvalResponseSchema } from './schema.ts';
import type { ApprovalRequest, Approve, Pending } from './types.ts';

/** Tickets exist only in memory. History/checkpoints contain facts, never reusable authority. */
export class ApprovalGate {
  private pending = new Map<string, Pending>();
  constructor(
    private store: SessionStore,
    private interactive: boolean,
    private currentTurn: (id: string) => string | undefined,
  ) {}
  snapshot(sessionId: string) {
    const request = [...this.pending.values()].find(
      (p) => p.request.sessionId === sessionId,
    )?.request;
    return request ? structuredClone(request) : null;
  }
  forTurn(sessionId: string, turnId: string): Approve {
    return async (details, signal) => {
      signal.throwIfAborted();
      const session = this.store.get(sessionId);
      assert(session.kind === 'agent', 'MODE_UNAVAILABLE', 'ChatBot 不提供执行审批。');
      assert(
        this.interactive && session.permission.approval === 'ask',
        'APPROVAL_UNAVAILABLE',
        '当前客户端或权限设置不允许发起审批。',
      );
      assert(
        this.currentTurn(sessionId) === turnId && !this.snapshot(sessionId),
        'APPROVAL_CONFLICT',
        '任务已结束或正在等待另一项审批。',
      );
      assert(
        Buffer.byteLength(JSON.stringify(details)) <= 128 * 1024,
        'APPROVAL_LIMIT',
        '本次操作参数过大，无法完整展示审批内容。',
      );
      const frozen = structuredClone(details);
      const fields = {
        ...frozen,
        approvalId: uuid(),
        sessionId,
        turnId,
        permissionRevision: session.permission.revision,
        argumentsHash: fingerprint(frozen.parameters),
        expiresAt: Date.now() + 300_000,
      };
      const request: ApprovalRequest = { ...fields, requestHash: fingerprint(fields) };
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
          this.pending.delete(request.approvalId);
          signal.removeEventListener('abort', abort);
          clearTimeout(timer);
        };
        const fail = (error: PraxisError) => {
          if (settled) return;
          settled = true;
          cleanup();
          try {
            this.store.transaction(() => {
              this.store.append(sessionId, 'approval/closed', {
                approvalId: request.approvalId,
                turnId,
                code: error.code,
              });
              if (this.store.get(sessionId).status === 'waiting_approval')
                this.store.update(sessionId, { status: 'running' });
            });
            reject(error);
          } catch (failure) {
            reject(failure);
          }
        };
        const abort = () => fail(new PraxisError('CANCELLED', '审批等待已取消。'));
        const timer = setTimeout(
          () => fail(new PraxisError('APPROVAL_EXPIRED', '审批已过期，请重新发起操作。')),
          Math.max(1, request.expiresAt - Date.now()),
        );
        this.pending.set(request.approvalId, {
          request,
          reject: fail,
          resolve: () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
          },
        });
        signal.addEventListener('abort', abort, { once: true });
        try {
          this.store.transaction(() => {
            this.store.update(sessionId, { status: 'waiting_approval' });
            this.store.append(
              sessionId,
              'approval/requested',
              request as unknown as Record<string, unknown>,
            );
          });
        } catch (error) {
          settled = true;
          cleanup();
          reject(error);
        }
        if (signal.aborted) abort();
      });
      let consumed = false;
      return () => {
        signal.throwIfAborted();
        assert(
          !consumed &&
            request.expiresAt > Date.now() &&
            this.currentTurn(sessionId) === turnId &&
            this.store.get(sessionId).permission.revision === request.permissionRevision,
          'APPROVAL_EXPIRED',
          '单次授权已使用、过期或权限已变化。',
        );
        consumed = true;
        this.store.append(sessionId, 'approval/consumed', {
          approvalId: request.approvalId,
          turnId,
          callId: request.callId,
          requestHash: request.requestHash,
        });
      };
    };
  }
  respond(owner: string, raw: unknown) {
    const input = approvalResponseSchema.parse(raw);
    const session = this.store.get(input.sessionId, owner);
    const pending = this.pending.get(input.approvalId),
      request = pending?.request;
    assert(
      pending &&
        request &&
        request.sessionId === session.id &&
        request.turnId === input.turnId &&
        request.turnId === this.currentTurn(session.id) &&
        request.requestHash === input.requestHash &&
        request.permissionRevision === session.permission.revision &&
        request.expiresAt > Date.now(),
      'APPROVAL_EXPIRED',
      '审批与当前任务或权限不匹配。',
    );
    this.store.transaction(() => {
      this.store.append(
        session.id,
        'approval/resolved',
        {
          approvalId: request.approvalId,
          turnId: request.turnId,
          decision: input.decision,
          requestHash: request.requestHash,
        },
        'user',
      );
      if (session.status === 'waiting_approval')
        this.store.update(session.id, { status: 'running' });
    });
    if (input.decision === 'approve-once') pending.resolve();
    else pending.reject(new PraxisError('APPROVAL_REJECTED', '用户拒绝此操作。'));
    return { accepted: true };
  }
  invalidate(sessionId: string) {
    for (const pending of this.pending.values())
      if (pending.request.sessionId === sessionId)
        pending.reject(new PraxisError('APPROVAL_EXPIRED', '权限已变化，旧审批已失效。'));
  }
}
