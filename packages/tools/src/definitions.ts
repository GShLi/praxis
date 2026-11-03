import { schemas } from './schemas.ts';

export const descriptions: Record<keyof typeof schemas, string> = {
  fs_list: '列出工作区目录。隐藏和敏感路径受 Host 策略限制。',
  fs_find: '按相对 glob 查找文件，递归使用 **。',
  fs_search: '有界单行文本搜索；支持字面量和 Unicode 正则，逐行返回首次命中。',
  fs_read: '读取带版本的 UTF-8 文本行。修改前必须先读取完整修改范围。',
  fs_write: '排他创建新文件，或使用先前完整读取的版本替换文件。',
  fs_apply_patch: '对同一文件版本进行精确、不重叠的文本替换。',
  process_exec: '在已验证的操作系统沙箱内运行命令。不可用时拒绝执行。',
  process_read: '读取本会话命令状态和有界输出；查询成功不等于命令成功。',
  process_list: '列出本会话的受管命令。',
  process_cancel: '终止本会话受管命令树，不回滚已发生的文件变化。',
  task_update_plan: '提交完整、版本化任务计划；最多一项进行中。',
  user_ask: '向实际用户询问需求；回答不代表执行审批，不要询问密钥。',
  artifact_read: '使用 Host 产物 ID 读取文本，不接受任意文件路径。',
};

export const ids: Record<keyof typeof schemas, string> = {
  fs_list: 'fs.list',
  fs_find: 'fs.find',
  fs_search: 'fs.search',
  fs_read: 'fs.read',
  fs_write: 'fs.write',
  fs_apply_patch: 'fs.apply_patch',
  process_exec: 'process.exec',
  process_read: 'process.read',
  process_list: 'process.list',
  process_cancel: 'process.cancel',
  task_update_plan: 'task.update_plan',
  user_ask: 'user.ask',
  artifact_read: 'artifact.read',
};
