import { assert, type Kind, type Message } from '@praxis/contracts';
export function validateResponse(message: Message, kind: Kind) {
  assert(
    kind !== 'chat' || !message.toolCalls?.length,
    'UNEXPECTED_TOOL_CALL',
    'ChatBot 不能执行工具调用。',
  );
  // Validate the entire batch before publishing or invoking any tool.
  if (message.toolCalls) {
    assert(
      message.toolCalls.length <= 64 &&
        new Set(message.toolCalls.map((c) => c.id)).size === message.toolCalls.length,
      'MODEL_PROTOCOL_ERROR',
      '无效工具批次。',
    );
    for (const call of message.toolCalls) {
      assert(call.id && call.name, 'MODEL_PROTOCOL_ERROR', '工具身份不完整。');
      JSON.parse(call.arguments);
    }
  }
}
