import { assert, PraxisError, safeError } from '@praxis/contracts';
import { ApprovalGate } from '@praxis/permissions';
import { SessionStore } from '@praxis/storage-local';
import { ToolExecutor } from '@praxis/tools';
import { WorkspaceFiles } from '@praxis/tools/files';
import { realpath } from 'node:fs/promises';
import { QuestionGate } from './questions.ts';
import { TurnSteps } from './turn-steps.ts';
import type { Active, RuntimeOptions } from './types.ts';
export class TurnExecutor {
  private workspaceOwners = new Map<string, string>();
  constructor(
    private store: SessionStore,
    private options: RuntimeOptions,
    private questions: QuestionGate,
    private approvals: ApprovalGate,
    private emit: (name: string, payload: unknown) => void,
  ) {}
  async run(id: string, turn: Active) {
    const session = this.store.get(id);
    const signal = turn.controller.signal;
    const plugins = this.options.plugins?.(session.kind) ?? [];
    let workspace: string | undefined;
    let claimed = false;
    const steps = new TurnSteps(this.store, this.options, this.emit);
    let terminal = 'completed';
    let workspaceLease:
      | Awaited<ReturnType<NonNullable<RuntimeOptions['acquireWorkspace']>>>
      | undefined;
    const timer = setTimeout(
      () => turn.controller.abort(new PraxisError('TURN_TIMEOUT', '任务时间预算已用完。')),
      Math.max(1, turn.deadline - Date.now()),
    );
    try {
      const config = await this.options.beginUse(session.ownerUserId, signal);
      signal.throwIfAborted();
      if (session.kind === 'agent') {
        workspace = await realpath(session.workspace!);
        assert(!this.workspaceOwners.has(workspace), 'WORKSPACE_BUSY', '此工作区已有活动执行。');
        this.workspaceOwners.set(workspace, id);
        workspaceLease = await this.options.acquireWorkspace?.(workspace, signal);
        workspaceLease?.onLost(() => turn.controller.abort());
        const files = await WorkspaceFiles.open(
          workspace,
          (kind, text) => this.store.artifact(id, kind, text),
          this.options.protectedPaths,
          () =>
            assert(
              this.store.get(id).permission.mode === 'workspace-write',
              'ACCESS_DENIED',
              '当前权限禁止写入。',
            ),
        );
        turn.executor = new ToolExecutor(
          id,
          this.store,
          files,
          this.questions.ask(id, turn),
          this.options.processes?.(session, this.store),
          plugins,
          this.approvals.forTurn(id, turn.id),
          () => {
            signal.throwIfAborted();
            assert(
              ++turn.tools <= (this.options.maxTools ?? 200),
              'BUDGET_EXHAUSTED',
              '工具预算已用完。',
            );
          },
        );
      }
      signal.throwIfAborted();
      const inputs = this.store.transaction(() => {
        const inputs = this.store.claim(id, turn.id, true);
        if (!inputs.length) return [];
        this.store.update(id, {
          status: 'running',
          title: session.title === '新会话' ? inputs[0]!.text.slice(0, 60) : session.title,
        });
        this.store.append(id, 'turn/started', {
          turnId: turn.id,
          inputIds: inputs.map((i) => i.id),
          providerId: config.id,
          configRevision: config.revision,
        });
        return inputs;
      });
      if (!inputs.length) return;
      claimed = true;
      await steps.run(session, turn, config);
    } catch (error) {
      terminal = signal.aborted ? 'cancelled' : 'failed';
      if (steps.partial)
        this.store.append(
          id,
          'assistant/partial',
          { turnId: turn.id, attemptId: steps.attemptId, content: steps.partial, incomplete: true },
          'model',
        );
      this.store.append(id, 'turn/error', { turnId: turn.id, ...safeError(error) });
      // Do not spin indefinitely on failed begin-use/configuration or poisoned pending tasks.
      this.store.suspend(id);
    } finally {
      turn.finishing = true;
      clearTimeout(timer);
      try {
        await turn.executor?.close();
      } catch {
        terminal = 'interrupted';
        this.store.append(id, 'execution/cleanup_unknown', { turnId: turn.id });
      }
      if (workspace && this.workspaceOwners.get(workspace) === id)
        this.workspaceOwners.delete(workspace);
      await workspaceLease?.release();
      this.store.transaction(() => {
        this.store.update(id, {
          status: terminal as 'completed' | 'cancelled' | 'failed' | 'interrupted',
        });
        this.store.append(id, 'turn/finished', {
          turnId: turn.id,
          status: terminal,
          claimed,
          steps: turn.steps,
          attempts: turn.attempts,
          tools: turn.tools,
        });
        this.store.checkpoint(id);
      });
    }
  }
}
