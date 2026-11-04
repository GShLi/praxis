import type { ToolResult } from '@praxis/contracts';

export const toolStatusText: Record<ToolResult['status'], string> = {
  succeeded: '已完成',
  running: '执行中',
  failed: '执行失败',
  denied: '未获批准',
  cancelled: '已取消',
  timed_out: '已超时',
  unknown: '结果未确认',
};

export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function textField(value: unknown, key: string): string | undefined {
  const field = record(value)?.[key];
  return typeof field === 'string' && field.length > 0 ? field : undefined;
}

export function parseToolResult(content: string): ToolResult | null {
  try {
    const value: unknown = JSON.parse(content);
    return isToolResult(value) ? value : null;
  } catch {
    return null; // Legacy or malformed records remain accessible as their original text.
  }
}

export function isToolResult(value: unknown): value is ToolResult {
  const item = record(value);
  if (!item) return false;
  return (
    typeof item.callId === 'string' &&
    typeof item.toolId === 'string' &&
    item.toolVersion === 1 &&
    typeof item.status === 'string' &&
    Object.hasOwn(toolStatusText, item.status) &&
    ['none', 'committed', 'partial', 'unknown'].includes(String(item.effectState)) &&
    Array.isArray(item.artifactIds) &&
    item.artifactIds.every((id) => typeof id === 'string') &&
    typeof item.truncated === 'boolean' &&
    typeof item.durationMs === 'number' &&
    Number.isFinite(item.durationMs) &&
    item.durationMs >= 0 &&
    (item.error === undefined ||
      (typeof record(item.error)?.code === 'string' &&
        typeof record(item.error)?.message === 'string'))
  );
}

const actions: Record<string, string> = {
  fs_list: '查看目录',
  fs_find: '查找文件',
  fs_search: '搜索文件内容',
  fs_read: '读取文件',
  fs_write: '写入文件',
  fs_apply_patch: '修改文件',
  process_exec: '运行命令',
  process_read: '查看命令输出',
  process_list: '查看命令列表',
  process_cancel: '停止命令',
  task_update_plan: '更新任务计划',
  user_ask: '询问你的意见',
  artifact_read: '读取历史产物',
};

export function toolAction(toolId: string, data?: unknown): string {
  const name = toolId.replace('.', '_');
  if (
    name === 'fs_write' &&
    ['create', 'created'].includes(textField(data, 'mode') ?? textField(data, 'operation') ?? '')
  )
    return '创建文件';
  return Object.hasOwn(actions, name)
    ? actions[name]!
    : toolId.startsWith('mcp')
      ? '调用远程工具'
      : '调用扩展工具';
}

export function toolTarget(data: unknown): string {
  return (
    textField(data, 'path') ??
    textField(data, 'uri') ??
    textField(data, 'description') ??
    textField(data, 'executionId') ??
    textField(data, 'artifactId') ??
    ''
  );
}

export function toolOutcome(result: ToolResult): string {
  const process = textField(result.data, 'processState');
  if (result.toolId.startsWith('process') && process) {
    const state =
      process === 'cancelling'
        ? '正在停止'
        : Object.hasOwn(toolStatusText, process)
          ? toolStatusText[process as ToolResult['status']]
          : '状态未确认';
    return result.status === 'succeeded'
      ? `命令${state}`
      : `${toolStatusText[result.status]} · 命令${state}`;
  }
  return toolStatusText[result.status];
}

export function toolVisualStatus(result: ToolResult): string {
  const process = textField(result.data, 'processState');
  if (result.status === 'succeeded' && result.toolId.startsWith('process') && process)
    return process === 'cancelling' || Object.hasOwn(toolStatusText, process) ? process : 'unknown';
  return result.status;
}

export function toolSummary(result: ToolResult): string {
  if (result.error) return result.error.message;
  const data = record(result.data);
  if (data?.diffArtifactId)
    return result.effectState === 'committed'
      ? '文件变更已记录，可查看历史快照。'
      : '已保留变更记录，文件状态尚未确认。';
  if (typeof data?.exitCode === 'number') return `命令退出码：${data.exitCode}`;
  if (Array.isArray(data?.matches))
    return `返回 ${data.matches.length} 条匹配${data.truncated || data.incomplete ? '（结果不完整）' : ''}`;
  if (Array.isArray(data?.entries)) return `返回 ${data.entries.length} 个目录项`;
  if (Array.isArray(data?.items)) return `记录 ${data.items.length} 项计划`;
  if (result.effectState === 'partial') return '操作产生了部分影响，请检查结果。';
  if (result.effectState === 'unknown') return '操作的实际影响尚未确认。';
  return result.status === 'succeeded' ? '已收到工具结果。' : toolStatusText[result.status];
}
