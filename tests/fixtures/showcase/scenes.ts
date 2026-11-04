/** Session scenes use real sidebar clicks; only settings have native hash routes. */
export const showcaseScenes = [
  { id: 'chat', sessionId: 'showcase-chat', buttonText: '山岚工作室 · 官网策划', mode: '聊天' },
  { id: 'code', sessionId: 'showcase-code', buttonText: '山岚工作室 · 响应式首页', mode: '聊天' },
  {
    id: 'agent-completed',
    sessionId: 'showcase-agent-completed',
    buttonText: '山岚官网 · 实现与验收',
    mode: 'Agent',
  },
  {
    id: 'approval',
    sessionId: 'showcase-approval',
    buttonText: '山岚官网 · 发布前检查',
    mode: 'Agent',
  },
  { id: 'models', hash: '#settings/models' },
  { id: 'mcp', hash: '#settings/mcp' },
  { id: 'account', hash: '#settings/account' },
] as const;
