import type { ModelRequest } from './types.ts';
export function serializeRequest(request: ModelRequest) {
  const { config } = request;
  const messages = request.messages.map((message) => ({
    role: message.role,
    content: message.content || (message.toolCalls?.length ? null : ''),
    ...(message.toolCalls
      ? {
          tool_calls: message.toolCalls.map((t) => ({
            id: t.id,
            type: 'function',
            function: { name: t.name, arguments: t.arguments },
          })),
        }
      : {}),
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    ...(message.reasoning ? { reasoning_content: message.reasoning } : {}),
  }));
  return JSON.stringify({
    model: config.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: config.maxOutputTokens,
    ...(request.tools.length
      ? {
          tools: request.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.modelName,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
        }
      : {}),
  });
}
