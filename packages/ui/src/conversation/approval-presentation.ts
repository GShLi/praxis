import type { ApprovalRequest } from '@praxis/permissions';
import { record, textField, toolAction } from './tool-presentation.ts';

export function approvalPresentation(approval: ApprovalRequest) {
  const parameters = record(approval.parameters);
  const name = approval.toolId.replace('.', '_');
  const action = toolAction(approval.toolId, parameters);
  const target =
    textField(parameters, 'path') ??
    textField(parameters, 'uri') ??
    approval.resources?.endpoint ??
    textField(parameters, 'executable') ??
    textField(parameters, 'executionId') ??
    approval.resources?.workspace ??
    '以完整参数为准';
  let effect = '批准后将以这里显示的参数执行一次操作。';
  if (name === 'fs_write')
    effect =
      parameters?.mode === 'create'
        ? '将在目标位置创建文件。'
        : '将写入目标文件；替换操作会更改现有内容。';
  else if (name === 'fs_apply_patch') effect = '将按所示补丁修改目标文件的内容。';
  else if (name === 'process_exec')
    effect = '将在指定工作目录运行命令，可能改变文件或产生其他命令效果。';
  else if (name === 'process_cancel') effect = '将停止此命令，已经产生的文件变化不会回滚。';
  else if (approval.resources?.endpoint || approval.toolId.startsWith('mcp'))
    effect = '将把所示参数发送到远程服务并执行操作；远端效果无法由本地沙箱限制。';
  return { action, target, effect, description: textField(parameters, 'description') };
}

export const resourceLabels: Record<string, string> = {
  workspace: '工作区',
  server: '远程服务',
  endpoint: '目标地址',
  configRevision: '配置版本',
};
