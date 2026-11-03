import { ProjectInstructions } from './instructions.ts';
import { assert, PraxisError, type Session, type ModelConfig } from '@praxis/contracts';
import type { ActivePlugin } from '@praxis/plugin-host';
import type { ApprovalGate } from '@praxis/permissions';
import type { SessionStore } from '@praxis/storage-local';
import { ToolExecutor, type ToolExtension } from '@praxis/tools';
import { WorkspaceFiles } from '@praxis/tools/files';
import type { QuestionGate } from './questions.ts';
import type { Active, RuntimeOptions } from './types.ts';

/** Per-turn tools share the same workspace permission, budget and approval gate. */
export async function createTurnTools(
  store: SessionStore,
  options: RuntimeOptions,
  session: Session,
  turn: Active,
  workspace: string,
  plugins: readonly ActivePlugin[],
  questions: QuestionGate,
  approvals: ApprovalGate,
  config?: ModelConfig,
) {
  const signal = turn.controller.signal;
  const files = await WorkspaceFiles.open(
    workspace,
    (kind, text) => store.artifact(session.id, kind, text),
    options.protectedPaths,
    () =>
      assert(
        store.get(session.id).permission.mode === 'workspace-write',
        'ACCESS_DENIED',
        '当前权限禁止写入。',
      ),
  );
  if (!turn.command) {
    const instructions = new ProjectInstructions(files, store, session.id, signal);
    turn.instructions = instructions;
    files.observeSearchDirectories((directory) => instructions.discoverDirectory(directory));
  }
  const processes = options.processes?.(session, store);
  let extension: ToolExtension | undefined;
  try {
    extension = config
      ? await options.toolExtension?.(
          session,
          config,
          approvals.forTurn(session.id, turn.id),
          signal,
          options.interactive ? questions.ask(session.id, turn) : undefined,
        )
      : undefined;
    signal.throwIfAborted();
    return new ToolExecutor(
      session.id,
      store,
      files,
      questions.ask(session.id, turn),
      processes,
      plugins,
      approvals.forTurn(session.id, turn.id),
      () => {
        signal.throwIfAborted();
        assert(++turn.tools <= (options.maxTools ?? 200), 'BUDGET_EXHAUSTED', '工具预算已用完。');
      },
      extension,
      turn.instructions?.beforeTool.bind(turn.instructions),
    );
  } catch (error) {
    const cleanup = await Promise.allSettled([
      Promise.resolve().then(() => extension?.close()),
      Promise.resolve().then(() => processes?.close()),
    ]);
    if (cleanup.some((result) => result.status === 'rejected'))
      throw new PraxisError('EXECUTION_CLEANUP_UNKNOWN', '初始化失败，且执行资源未能确认释放。');
    throw error;
  }
}
