import type { SettingsTab } from '../navigation-state.ts';

export function settingsScope(tab: SettingsTab, desktop: boolean): string {
  switch (tab) {
    case 'general':
    case 'appearance':
      return '偏好自动保存在此客户端。';
    case 'personalization':
      return desktop ? '应用于此客户端的 ChatBot 与 Agent。' : '应用于当前账户的 Web 对话。';
    case 'models':
      return desktop ? '模型配置保存在此客户端。' : '模型配置保存在当前账户。';
    case 'agent':
      return '应用于当前 Agent 任务与工作区。';
    case 'mcp':
      return '连接保存在此客户端，仅供 Agent 使用。';
    case 'plugins':
      return '插件保存在此客户端，与 CLI 独立管理。';
    case 'account':
      return '管理当前账户的登录与客户端访问。';
    case 'data':
      return '管理此客户端与当前会话的数据。';
    case 'about':
      return '当前客户端信息';
  }
}
