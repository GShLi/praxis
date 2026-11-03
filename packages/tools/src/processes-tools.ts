import type { Permission, ToolResult } from '@praxis/contracts';
import { assert } from '@praxis/contracts';
import { schemas } from './schemas.ts';
import type { ProcessService } from './types.ts';
export async function executeProcessesTool(
  processes: ProcessService | undefined,
  permission: Permission,
  name: keyof typeof schemas,
  raw: unknown,
  signal: AbortSignal,
  result: ToolResult,
) {
  switch (name) {
    case 'process_exec':
      assert(processes, 'SANDBOX_UNAVAILABLE', '此平台命令隔离尚未通过验证。');
      result.data = await processes.execute(
        schemas.process_exec.parse(raw),
        signal,
        permission,
        result.callId,
      );
      result.effectState = 'unknown';
      {
        const state = (result.data as { processState: string }).processState;
        result.status =
          state === 'running' || state === 'cancelling'
            ? 'running'
            : state === 'succeeded'
              ? 'succeeded'
              : state === 'cancelled'
                ? 'cancelled'
                : 'failed';
      }
      break;
    case 'process_read':
      assert(processes, 'EXECUTION_NOT_FOUND', '此会话没有命令。');
      result.data = await processes.read(schemas.process_read.parse(raw), signal);
      break;
    case 'process_list':
      result.data = processes?.list(schemas.process_list.parse(raw)) ?? [];
      break;
    case 'process_cancel':
      assert(processes, 'EXECUTION_NOT_FOUND', '此会话没有命令。');
      result.data = await processes.cancel(schemas.process_cancel.parse(raw));
      break;
  }
}
