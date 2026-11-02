import type { ToolCall } from '@praxis/contracts';
import { assert, PraxisError } from '@praxis/contracts';
import type { ActivePlugin } from '@praxis/plugin-host';
export async function checkPluginPolicies(
  plugins: readonly ActivePlugin[],
  call: ToolCall,
  raw: unknown,
  signal: AbortSignal,
) {
  const reasons: string[] = [];
  for (const current of plugins)
    for (const check of current.checks) {
      signal.throwIfAborted();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const verdict = await Promise.race([
          check(call.name, structuredClone(raw)),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new PraxisError('PLUGIN_TIMEOUT', '插件策略检查超时。')),
              2000,
            );
          }),
        ]);
        assert(['deny', 'ask', 'pass'].includes(verdict), 'PLUGIN_INVALID', '插件策略结果无效。');
        assert(verdict !== 'deny', 'ACCESS_DENIED', '插件策略拒绝此操作。');
        if (verdict === 'ask') reasons.push(current.manifest.id);
      } finally {
        clearTimeout(timer);
      }
    }

  return reasons;
}
