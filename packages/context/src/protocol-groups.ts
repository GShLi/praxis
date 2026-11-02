import type { Message } from '@praxis/contracts';
import { assert } from '@praxis/contracts';

export function protocolGroups(messages: Message[]): Message[][] {
  const groups: Message[][] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    assert(message.role !== 'tool', 'INVALID_CONTEXT', '工具结果缺少对应请求。');
    const group = [message];
    if (message.toolCalls?.length) {
      const pending = new Set(message.toolCalls.map((c) => c.id));
      assert(pending.size === message.toolCalls.length, 'INVALID_CONTEXT', '工具调用 ID 重复。');
      for (let count = 0; count < message.toolCalls.length; count++) {
        const result = messages[++index];
        assert(
          result?.role === 'tool' && result.toolCallId && pending.delete(result.toolCallId),
          'INVALID_CONTEXT',
          '工具请求和结果配对不完整。',
        );
        group.push(result);
      }
    }
    groups.push(group);
  }
  return groups;
}
