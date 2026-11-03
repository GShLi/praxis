// Development-only fixture. It never contacts a model or mutates a workspace.
import { createRoot } from 'react-dom/client';
import { App } from '@praxis/ui';
import type { PraxisClient } from '@praxis/ui/client';
import type { Event } from '@praxis/contracts';
import { providerFixture } from './provider-fixture.ts';

let approvalPending = true;
const approvalListeners = new Set<(event: Event) => void>();

const client: PraxisClient = {
  desktop: new URLSearchParams(location.search).get('client') === 'desktop',
  async profile() {
    return { id: 'development-fixture', username: '开发样例', scopes: [] };
  },
  async plugins() {
    return { revision: 0, value: [] };
  },
  async mcpServers() {
    return { revision: 0, value: [] };
  },
  async diagnostics() {
    return { platform: '开发样例', arch: '未读取系统', node: '无 Host 连接', fixture: true };
  },
  async inspectPlugin() {
    throw new Error('开发样例不会读取或安装插件。');
  },
  async saveMcp() {
    throw new Error('开发样例不会保存真实连接配置。');
  },
  async respondApproval(input) {
    if (input.sessionId !== 'approval-preview' || !approvalPending)
      throw new Error('该样例审批已结束。');
    approvalPending = false;
    for (const listener of approvalListeners)
      listener({
        eventId: 'fixture-event',
        sessionId: 'approval-preview',
        seq: 1,
        schemaVersion: 1,
        type: 'approval/resolved',
        source: 'user',
        timestamp: new Date().toISOString(),
        payload: { approvalId: input.approvalId, decision: input.decision },
      });
  },
  async current() {
    return true;
  },
  async login() {},
  async logout() {},
  ...providerFixture(),
  async list() {
    return [
      {
        id: 'chat-preview',
        title: 'HelloWorld 前端页面 · 样例',
        kind: 'chat',
        status: 'completed',
      },
      {
        id: 'agent-preview',
        title: '创建欢迎页 · 样例',
        kind: 'agent',
        status: 'completed',
        workspace: '/demo/hello-world',
      },
      {
        id: 'approval-preview',
        title: '执行审批 · 界面样例',
        kind: 'agent',
        status: approvalPending ? 'waiting_approval' : 'completed',
        workspace: '/demo/hello-world',
      },
    ];
  },
  async create() {
    throw new Error('开发样例不能创建真实会话。');
  },
  async send() {
    throw new Error('开发样例不会调用模型。');
  },
  async cancel() {},
  listen(id, _after, listener) {
    if (id === 'approval-preview') {
      approvalListeners.add(listener);
      return () => {
        approvalListeners.delete(listener);
      };
    }
    return () => {};
  },
  async read(id) {
    if (id === 'approval-preview')
      return {
        session: {
          id,
          title: '执行审批 · 界面样例',
          kind: 'agent',
          status: approvalPending ? 'waiting_approval' : 'completed',
          workspace: '/demo/hello-world',
        },
        throughSeq: approvalPending ? 0 : 1,
        turnId: approvalPending ? 'fixture-turn' : null,
        messages: [
          {
            id: 'fixture-user',
            role: 'user',
            content: '这是审批界面样例，没有连接 Host，不会写入文件或授予真实权限。',
          },
        ],
        approval: approvalPending
          ? {
              approvalId: '00000000-0000-4000-8000-000000000001',
              sessionId: id,
              turnId: 'fixture-turn',
              callId: 'fixture-call',
              toolId: 'fs.write',
              parameters: {
                path: 'index.html',
                mode: 'create',
                content: '<h1>Hello World！！！</h1>',
              },
              reason: '界面样例：项目策略要求在创建文件前确认内容。',
              resources: { workspace: '/demo/hello-world' },
              permissionRevision: 0,
              argumentsHash: '0'.repeat(64),
              expiresAt: Date.now() + 300000,
              requestHash: '0'.repeat(64),
            }
          : null,
      };
    return {
      session: {
        id,
        title: '界面测试样例',
        kind: id === 'agent-preview' ? 'agent' : 'chat',
        status: 'completed',
        ...(id === 'agent-preview' ? { workspace: '/demo/hello-world' } : {}),
      },
      throughSeq: 0,
      turnId: null,
      messages: [
        { id: 'u1', role: 'user', content: '帮我写一个前端页面，输出 HelloWorld！' },
        ...(id === 'agent-preview'
          ? [
              {
                id: 't1',
                role: 'tool',
                content: JSON.stringify({
                  toolId: 'fs.write',
                  status: 'succeeded',
                  effectState: 'committed',
                  data: { path: '/demo/hello-world/index.html', diffArtifactId: 'fixture-change' },
                  artifactIds: ['fixture-change'],
                }),
              },
            ]
          : []),
        {
          id: 'a1',
          role: 'assistant',
          content:
            '下面是一个最简单的前端页面，使用 HTML 和 CSS 在浏览器中显示 **HelloWorld！**。\n\n```html\n<!doctype html>\n<html lang="zh-CN">\n  <meta charset="utf-8" />\n  <title>HelloWorld</title>\n  <h1>HelloWorld！</h1>\n</html>\n```\n\n将代码保存为 `index.html`，在浏览器中打开即可。\n\n> 此会话是界面测试数据，没有调用模型或执行工具。',
        },
      ],
    };
  },
  async readArtifact() {
    return {
      kind: 'file-change',
      content: JSON.stringify({
        path: '/demo/hello-world/index.html',
        before: null,
        after: '<!doctype html>\n<h1>HelloWorld！</h1>\n',
      }),
    };
  },
};
document.documentElement.dataset.theme = localStorage.getItem('praxis-theme') ?? 'system';
document.documentElement.style.setProperty(
  '--message-font',
  `${localStorage.getItem('praxis-font') ?? '16'}px`,
);
createRoot(document.getElementById('root')!).render(<App client={client} />);
