import type { Message, ToolResult } from '@praxis/contracts';
import { hash, SessionStore, uuid } from '@praxis/storage-local';
import type { Active } from './types.ts';
export async function executeToolBatch(
  store: SessionStore,
  id: string,
  turn: Active,
  stepId: string,
  message: Message,
  maxTools: number,
) {
  const signal = turn.controller.signal;
  for (const call of message.toolCalls ?? []) {
    const callId = uuid();
    let result: ToolResult;
    if (signal.aborted || ++turn.tools > maxTools) {
      result = {
        callId,
        toolId: call.name,
        toolVersion: 1,
        status: 'cancelled',
        effectState: 'none',
        error: {
          code: signal.aborted ? 'CANCELLED' : 'BUDGET_EXHAUSTED',
          message: '未执行此调用。',
        },
        artifactIds: [],
        truncated: false,
        durationMs: 0,
      };
    } else {
      store.append(id, 'tool/intent', {
        turnId: turn.id,
        stepId,
        callId,
        providerCallId: call.id,
        name: call.name,
        argumentsHash: hash(call.arguments),
      });
      result = await turn.executor!.execute(call, callId, signal);
    }
    // Persist result and model projection together, never re-run a side effect after storage failure.
    const projected = turn.executor!.project(result);
    store.transaction(() => {
      store.append(id, 'tool/result', { turnId: turn.id, stepId, result }, 'tool');
      store.message(id, {
        id: uuid(),
        role: 'tool',
        toolCallId: call.id,
        content: projected,
      });
    });
  }
}
