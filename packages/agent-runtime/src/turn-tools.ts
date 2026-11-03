import { assert, type Session, type ModelConfig } from '@praxis/contracts';
import type { ActivePlugin } from '@praxis/plugin-host';
import type { ApprovalGate } from '@praxis/permissions';
import type { SessionStore } from '@praxis/storage-local';
import { ToolExecutor } from '@praxis/tools';
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
  return new ToolExecutor(
    session.id,
    store,
    files,
    questions.ask(session.id, turn),
    options.processes?.(session, store),
    plugins,
    approvals.forTurn(session.id, turn.id),
    () => {
      signal.throwIfAborted();
      assert(++turn.tools <= (options.maxTools ?? 200), 'BUDGET_EXHAUSTED', '工具预算已用完。');
    },
    config
      ? await options.toolExtension?.(
          session,
          config,
          approvals.forTurn(session.id, turn.id),
          signal,
        )
      : undefined,
  );
}
