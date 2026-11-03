import { PraxisError } from '@praxis/contracts';
import { ApprovalGate } from '@praxis/permissions';
import { uuid } from '@praxis/storage-local';
import { ToolExecutor, type Ask } from '@praxis/tools';
import { WorkspaceFiles } from '@praxis/tools/files';
import { mcpFixture } from './mcp-server.ts';

export async function mcpExecutor(legacy = false, resources = false, ask?: Ask) {
  const env = await mcpFixture(legacy, resources);
  const cancel = new AbortController();
  const approval = new ApprovalGate(env.store, true, () => 'turn-fixture');
  const decisions = { autoApprove: true, deny: false };
  env.store.on('event', (event) => {
    if (event.type !== 'approval/requested' || !decisions.autoApprove) return;
    const pending = approval.snapshot(env.session.id)!;
    approval.respond('alice', {
      sessionId: env.session.id,
      turnId: 'turn-fixture',
      approvalId: pending.approvalId,
      requestHash: pending.requestHash,
      decision: decisions.deny ? 'deny' : 'approve-once',
    });
  });
  await env.enable();
  const extension = await env.mcp.create(
    env.session,
    32000,
    approval.forTurn(env.session.id, 'turn-fixture'),
    cancel.signal,
    ['fixture-model-secret'],
    ask,
  );
  const files = await WorkspaceFiles.open(env.root, (kind, text) =>
    env.store.artifact(env.session.id, kind, text),
  );
  const executor = new ToolExecutor(
    env.session.id,
    env.store,
    files,
    async () => {
      throw new PraxisError('UNEXPECTED_QUESTION', 'No questions in fixture');
    },
    undefined,
    [],
    undefined,
    undefined,
    extension,
  );
  executor.boundary();
  return {
    ...env,
    cancel,
    decisions,
    approval,
    executor,
    execute: (name: string, args: object) =>
      executor.execute(
        { id: uuid(), name, arguments: JSON.stringify(args) },
        uuid(),
        cancel.signal,
      ),
    async select() {
      const result = await executor.execute(
        {
          id: uuid(),
          name: 'mcp_discover_tools',
          arguments: JSON.stringify({ serverId: env.config.id }),
        },
        uuid(),
        cancel.signal,
      );
      if (result.status !== 'succeeded') throw new Error(JSON.stringify(result.error));
      executor.boundary();
      return executor.definitions.find((t) => t.modelName.startsWith('mcp__'))!.modelName;
    },
    async close() {
      cancel.abort();
      await executor.close();
      await env.close();
    },
  };
}
