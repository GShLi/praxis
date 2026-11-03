import { assert, PraxisError, type Permission } from '@praxis/contracts';
import { uuid } from '@praxis/storage-local';
import type { z } from 'zod';
import { schemas } from '../schemas.ts';
import type { ProcessService } from '../types.ts';
import { CommandExecution } from './execution.ts';
import { ExecutionJournal } from './journal.ts';
import type { CommandInput, PreparedCommand, ProcessOptions } from './types.ts';

export class ManagedProcesses implements ProcessService {
  private journal: ExecutionJournal;
  private executions = new Map<string, CommandExecution>();
  private pending: Promise<unknown> | undefined;
  private lifetime = new AbortController();
  private closing: Promise<void> | undefined;
  private failure: Error | undefined;
  constructor(private options: ProcessOptions) {
    this.journal = new ExecutionJournal(options.store, options.sessionId);
  }
  get active() {
    return Boolean(this.pending) || [...this.executions.values()].some((run) => run.active);
  }
  async execute(
    input: CommandInput,
    signal: AbortSignal,
    permission: Permission,
    callId: string = uuid(),
  ) {
    assert(!this.lifetime.signal.aborted, 'EXECUTION_CLOSED', '本轮命令执行已关闭。');
    assert(!this.active, 'WORKSPACE_BUSY', '活动命令占用工作区。');
    const combined = AbortSignal.any([signal, this.lifetime.signal]);
    const operation = this.launch(input, combined, permission, callId);
    this.pending = operation;
    void operation.then(
      () => {
        this.pending = undefined;
      },
      () => {
        this.pending = undefined;
      },
    );
    return operation;
  }
  private async launch(
    input: CommandInput,
    signal: AbortSignal,
    permission: Permission,
    callId: string,
  ) {
    signal.throwIfAborted();
    const { store, sessionId, deadline } = this.options;
    const session = store.get(sessionId);
    assert(
      session.workspace && session.kind === 'agent',
      'WORKSPACE_REQUIRED',
      '命令需要 Agent 工作区。',
    );
    assert(deadline > Date.now(), 'BUDGET_EXHAUSTED', '本轮执行时间已用完。');
    const preparationSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    ]);
    const prepared = await this.options.backend.prepare(input, {
      workspace: session.workspace,
      permission,
      deadline,
      signal: preparationSignal,
    });
    let transferred = false;
    try {
      await this.authorize(prepared, permission, callId, preparationSignal);
      const run = this.register(prepared, callId);
      const executionId = run.record.executionId;
      transferred = true;
      void run.finished.then(() => this.executions.delete(executionId));
      await run.start(signal, Math.min(prepared.plan.timeoutMs, deadline - Date.now()));
      await run.wait(input.yieldMs, signal);
      return { ...run.record, ...run.output.read() };
    } finally {
      if (!transferred) {
        try {
          await prepared.close();
        } catch {
          const error = new PraxisError('EXECUTION_CLEANUP_UNKNOWN', '命令准备资源未能确认释放。');
          this.fail(error);
          throw error;
        }
      }
    }
  }
  private register(prepared: PreparedCommand, callId: string) {
    const record = {
      executionId: uuid(),
      turnId: this.options.turnId,
      description: prepared.plan.description,
      processState: 'running' as const,
      exitCode: null,
      signal: null,
      startedAt: new Date().toISOString(),
    };
    try {
      this.journal.intent(record, prepared.plan, callId);
    } catch {
      const error = new PraxisError(
        'EXECUTION_RECORD_FAILED',
        '命令启动意图保存失败，未执行命令。',
      );
      this.fail(error);
      throw error;
    }
    const run = new CommandExecution(record, prepared, this.journal, this.fail.bind(this));
    this.executions.set(record.executionId, run);
    return run;
  }
  private async authorize(
    prepared: PreparedCommand,
    permission: Permission,
    callId: string,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const { store, sessionId, deadline } = this.options;
    const plan = JSON.stringify(prepared.plan);
    const grant = await this.options.approve(
      {
        callId,
        toolId: 'process.exec',
        parameters: structuredClone(prepared.plan),
        reason: '执行本地命令',
        resources: { workspace: store.get(sessionId).workspace! },
      },
      signal,
    );
    signal.throwIfAborted();
    const current = store.get(sessionId).permission;
    assert(JSON.stringify(prepared.plan) === plan, 'APPROVAL_STALE', '审批期间命令计划发生变化。');
    assert(
      current.revision === permission.revision &&
        current.mode === permission.mode &&
        current.approval === permission.approval,
      'APPROVAL_STALE',
      '审批期间执行权限发生变化。',
    );
    assert(Date.now() < deadline, 'BUDGET_EXHAUSTED', '本轮执行时间已用完。');
    grant();
  }
  async read(input: z.infer<typeof schemas.process_read>, signal: AbortSignal) {
    signal.throwIfAborted();
    const run = this.executions.get(input.executionId);
    if (run) {
      await run.wait(input.waitMs, signal);
      return { ...run.record, ...run.output.read(input.cursor, input.maxBytes) };
    }
    return {
      ...this.journal.record(input.executionId),
      ...this.journal.output(input.executionId).read(input.cursor, input.maxBytes),
    };
  }
  list(input: z.infer<typeof schemas.process_list>) {
    const live = [...this.executions.values()].map((run) => ({ ...run.record }));
    if (!input.includeFinished) return live.filter((run) => !run.finishedAt).slice(0, input.limit);
    const records = new Map(
      this.journal.list(input.limit).map((record) => [record.executionId, record]),
    );
    for (const record of live) records.set(record.executionId, record);
    return [...records.values()]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, input.limit);
  }
  async cancel(input: z.infer<typeof schemas.process_cancel>) {
    const run = this.executions.get(input.executionId);
    if (!run) {
      const record = this.journal.record(input.executionId);
      assert(
        record.finishedAt && record.processState !== 'unknown',
        'EXECUTION_CLEANUP_UNKNOWN',
        '旧命令没有清理确认，不能恢复或按 PID 终止。',
      );
      return { executionId: input.executionId, outcome: 'already_finished' as const };
    }
    if (!run.active)
      return { executionId: input.executionId, outcome: 'already_finished' as const };
    run.requestStop();
    await run.finished;
    assert(
      run.record.processState !== 'unknown',
      'EXECUTION_CLEANUP_UNKNOWN',
      '无法确认命令已终止。',
    );
    return { executionId: input.executionId, outcome: 'terminated' as const };
  }
  close() {
    return (this.closing ??= this.drain());
  }
  private async drain() {
    this.lifetime.abort();
    await Promise.allSettled([this.pending]);
    for (const run of this.executions.values()) run.requestStop();
    await Promise.all([...this.executions.values()].map((run) => run.finished));
    if (this.failure) throw this.failure;
  }
  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    this.lifetime.abort();
    try {
      this.options.onFatal(
        error instanceof PraxisError
          ? error
          : new PraxisError('EXECUTION_FAILED', '命令执行失败。'),
      );
    } catch {
      /* Observer failure cannot prevent owned resource cleanup; close still rejects. */
    }
  }
}
