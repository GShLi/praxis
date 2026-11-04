import type { Event, ToolResult } from '@praxis/contracts';
import type { ApprovalRequest } from '@praxis/permissions';
import type { Snapshot, ViewMessage } from '@praxis/ui/client';

const workspace = '/demo/shanlan-studio';
export const completedId = 'showcase-agent-completed';
export const approvalId = 'showcase-approval';

export const fileChanges = {
  'showcase-grid-diff': {
    path: 'src/styles/projects.css',
    before: '.project-grid {\n  display: flex;\n  gap: 32px;\n}\n.project-card { width: 360px; }\n',
    after: [
      '.project-grid {',
      '  display: grid;',
      '  grid-template-columns: repeat(3, minmax(0, 1fr));',
      '  gap: 24px;',
      '}',
      '@media (max-width: 960px) {',
      '  .project-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }',
      '}',
      '@media (max-width: 640px) {',
      '  .project-grid { grid-template-columns: minmax(0, 1fr); gap: 16px; }',
      '}',
      '.project-card:focus-visible {',
      '  outline: 2px solid #35594b;',
      '  outline-offset: 6px;',
      '}',
      '',
    ].join('\n'),
  },
  'showcase-content-diff': {
    path: 'src/content/projects.ts',
    before: 'export const projects = [];\n',
    after: [
      '// Fictional portfolio demonstration projects.',
      'export const projects = [',
      '  { slug: "yiye", title: "一叶", discipline: "品牌识别" },',
      '  { slug: "mandu", title: "慢读", discipline: "空间设计" },',
      '  { slug: "tingsong", title: "听松", discipline: "数字体验" },',
      '];',
      '',
    ].join('\n'),
  },
};

const plan = [
  { id: 'inspect', title: '检查首页结构与项目内容', status: 'completed' },
  { id: 'implement', title: '实现响应式网格与键盘焦点', status: 'completed' },
  { id: 'verify', title: '记录检查结果并整理交接', status: 'completed' },
];

function tool(
  callId: string,
  toolId: string,
  data: Record<string, unknown>,
  durationMs: number,
  artifactIds: string[] = [],
): ToolResult {
  return {
    callId,
    toolId,
    toolVersion: 1,
    status: 'succeeded',
    effectState: artifactIds.length || toolId === 'task.update_plan' ? 'committed' : 'none',
    data,
    durationMs,
    artifactIds,
    truncated: false,
  };
}

const results: ToolResult[] = [
  tool(
    'showcase-read',
    'fs.read',
    {
      path: 'src/components/ProjectGrid.tsx',
      content: 'export function ProjectGrid() { /* fictional existing component */ }',
    },
    18,
  ),
  tool(
    'showcase-grid',
    'fs.apply_patch',
    {
      path: fileChanges['showcase-grid-diff'].path,
      diffArtifactId: 'showcase-grid-diff',
    },
    47,
    ['showcase-grid-diff'],
  ),
  tool(
    'showcase-content',
    'fs.write',
    {
      path: fileChanges['showcase-content-diff'].path,
      mode: 'replace',
      diffArtifactId: 'showcase-content-diff',
    },
    31,
    ['showcase-content-diff'],
  ),
  tool('showcase-plan', 'task.update_plan', { revision: 2, items: plan }, 5),
];

function event(seq: number, type: string, seconds: number, payload: Event['payload']): Event {
  return {
    eventId: `showcase-event-${seq}`,
    sessionId: completedId,
    seq,
    schemaVersion: 1,
    type,
    source: 'host',
    timestamp: new Date(Date.UTC(2026, 10, 4, 8, 15, seconds)).toISOString(),
    payload: { turnId: 'showcase-completed-turn', ...payload },
  };
}

const toolMessages: ViewMessage[] = results.map((result) => ({
  id: result.callId,
  role: 'tool',
  content: JSON.stringify(result),
}));

/** Synthetic history only: none of these writes or checks is executed by the fixture. */
export const completed: Snapshot = {
  session: {
    id: completedId,
    title: '山岚官网 · 实现与验收',
    kind: 'agent',
    status: 'completed',
    workspace,
    permissionMode: 'workspace-write',
    permissionRevision: 1,
    createdAt: '2026-11-04T08:15:00.000Z',
  },
  throughSeq: 6,
  turnId: null,
  events: [
    event(1, 'turn/started', 0, {}),
    ...results.map((result, index) =>
      event(index + 2, 'tool/result', (index + 1) * 22, { result }),
    ),
    event(6, 'turn/finished', 132, { status: 'completed' }),
  ],
  messages: [
    {
      id: 'showcase-agent-user',
      role: 'user',
      content:
        '请按前面的设计实现山岚官网精选作品区，修复手机横向溢出，并加入一叶、慢读、听松三个案例。保留原生链接，不部署。这里是虚构项目的演示记录。',
    },
    {
      id: 'showcase-agent-plan',
      role: 'assistant',
      content:
        '### 实施计划\n\n1. 阅读现有作品组件，确认布局与内容边界。\n2. 将固定宽度改为 3 / 2 / 1 列网格，补齐键盘焦点。\n3. 整理变更与验收清单，保留发布前待办。\n\n只修改作品数据和对应样式；不执行部署。',
    },
    ...toolMessages,
    {
      id: 'showcase-agent-summary',
      role: 'assistant',
      content:
        '### 已完成 · 精选作品区\n\n| 变更 | 结果 |\n| --- | --- |\n| 响应式网格 | 桌面 3 列 / 平板 2 列 / 手机 1 列 |\n| 键盘导航 | 保留原生链接，补齐可见焦点 |\n| 项目内容 | 一叶、慢读、听松三个案例 |\n\n**2 个文件变更**，可在任务概览中打开差异。\n\n- [x] 布局与内容更新（演示记录）\n- [ ] 真实浏览器验收、图片授权与上线检查\n\n> 本任务为虚构历史；未运行真实工具、测试或部署。',
    },
  ],
};

const approval: ApprovalRequest = {
  approvalId: '00000000-0000-4000-8000-000000000008',
  sessionId: approvalId,
  turnId: 'showcase-approval-turn',
  callId: 'showcase-checklist-write',
  toolId: 'fs.write',
  parameters: {
    path: 'docs/launch-checklist.md',
    mode: 'create',
    content:
      '# 山岚官网 · 发布前检查（演示）\n\n- [ ] 复核内容与图片授权\n- [ ] 检查三个目标视口\n- [ ] 键盘导航与焦点检查\n- [ ] 确认发布目标与回滚方案\n',
  },
  reason:
    '演示审批：创建发布前检查清单需要你确认目标与完整内容。此演示中的批准和拒绝均不会执行操作。',
  resources: { workspace },
  permissionRevision: 1,
  argumentsHash: '0'.repeat(64),
  requestHash: '0'.repeat(64),
  expiresAt: Date.UTC(2099, 0, 1),
};

export const awaitingApproval: Snapshot = {
  session: {
    id: approvalId,
    title: '山岚官网 · 发布前检查',
    kind: 'agent',
    status: 'waiting_approval',
    workspace,
    permissionMode: 'read-only',
    permissionRevision: 1,
    createdAt: '2026-11-04T09:00:00.000Z',
  },
  throughSeq: 0,
  turnId: 'showcase-approval-turn',
  approval,
  messages: [
    {
      id: 'showcase-approval-user',
      role: 'user',
      content: '整理一份发布前检查清单。先让我确认文件内容，不连接任何部署平台，也不要直接上线。',
    },
    {
      id: 'showcase-approval-assistant',
      role: 'assistant',
      content:
        '### 等待确认 · 发布前检查\n\n准备创建 **docs/launch-checklist.md**，包含内容授权、响应式、键盘导航和发布回滚四项检查。\n\n文件尚未写入，也没有部署操作。请展开审批卡查看完整参数。\n\n> 这是只读演示；审批按钮会显示演示提示，不会授予权限或改变文件。',
    },
  ],
};
