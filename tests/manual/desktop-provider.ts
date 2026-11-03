import type { Completion, ModelRequest } from '@praxis/model-core';
import type { PraxisPlugin } from '@praxis/plugin-sdk';
import { randomUUID } from 'node:crypto';

function answer(content: string, name?: string, args?: Record<string, unknown>): Completion {
  return {
    message: {
      id: randomUUID(),
      role: 'assistant',
      content,
      ...(name ? { toolCalls: [{ id: randomUUID(), name, arguments: JSON.stringify(args) }] } : {}),
    },
    usage: { input: 10, output: 20 },
    finishReason: name ? 'tool_calls' : 'stop',
  };
}

async function complete(request: ModelRequest): Promise<Completion> {
  request.signal.throwIfAborted();
  const last = request.messages.at(-1);
  if (last?.role === 'user' && last.content === '等待取消') {
    request.onDelta('测试模型正在等待取消。');
    await new Promise<void>((_resolve, reject) => {
      request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
    });
  }
  if (last?.role === 'user' && last.content === '创建页面')
    return answer('', 'fs_write', {
      path: 'index.html',
      mode: 'create',
      content: '<h1>Hello World！！！</h1>\n',
    });
  if (last?.role === 'user' && last.content === '修改页面')
    return answer('', 'fs_read', { path: 'index.html' });
  if (last?.role === 'tool') {
    const result = JSON.parse(last.content) as { toolId: string; data: { fileVersion?: string } };
    if (result.toolId === 'fs.read')
      return answer('', 'fs_apply_patch', {
        path: 'index.html',
        expectedVersion: result.data.fileVersion,
        edits: [{ oldText: 'Hello World', newText: '你好 Praxis', expectedMatches: 1 }],
      });
  }
  const content =
    last?.role === 'tool'
      ? '测试模型：文件工具已返回，请查看工具结果。'
      : `测试模型（未调用厂商）：${last?.content ?? ''}`;
  request.onDelta(content);
  return answer(content);
}

export default {
  activate(context) {
    context.registerProvider('model', { complete });
  },
} satisfies PraxisPlugin;
