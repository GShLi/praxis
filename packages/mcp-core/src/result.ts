import { assert } from '@praxis/contracts';
import type { JsonSchema } from '@praxis/schema';
import { compileSchema } from '@praxis/schema';
import { z } from 'zod';
import { text } from './config.ts';

export function normalizeResult(raw: unknown, outputSchema?: JsonSchema) {
  assert(
    Buffer.byteLength(JSON.stringify(raw) ?? '') <= 2 * 1024 * 1024,
    'MCP_RESULT_LIMIT',
    '结果超过 2 MiB。',
  );
  const result = z
    .object({
      content: z.array(z.object({ type: z.string() }).passthrough()).max(1000),
      structuredContent: z.json().optional(),
      isError: z.boolean().optional(),
    })
    .parse(raw);
  if (outputSchema && !result.isError)
    compileSchema(outputSchema).validate(result.structuredContent);
  const unsupportedContent: string[] = [];
  const content = result.content.map((block) => {
    if (block.type === 'text') return { type: 'text', text: z.string().parse(block.text) };
    if (block.type === 'resource_link')
      return { type: 'resource_link', uri: text.parse(block.uri), name: text.parse(block.name) };
    if (
      block.type === 'resource' &&
      block.resource &&
      typeof block.resource === 'object' &&
      'text' in block.resource
    ) {
      const item = z.object({ uri: text, text: z.string() }).parse(block.resource);
      return { type: 'resource', resource: item };
    }
    unsupportedContent.push(block.type);
    return { type: block.type, unsupported: true };
  });
  return {
    status: result.isError ? 'failed' : 'succeeded',
    effectState: 'unknown',
    content,
    ...(result.structuredContent !== undefined
      ? { structuredContent: result.structuredContent }
      : {}),
    unsupportedContent,
  };
}
