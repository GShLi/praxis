import { UriTemplate } from '@modelcontextprotocol/client';
import { fingerprint } from '@praxis/config';
import { assert, PraxisError } from '@praxis/contracts';
import { z } from 'zod';
import type { ResourceEntry } from './resource-catalog.ts';

export function resourceUri(entry: ResourceEntry, args?: Record<string, string>) {
  if ('uri' in entry) return entry.uri;
  let template: UriTemplate;
  try {
    template = new UriTemplate(entry.uriTemplate);
  } catch {
    throw new PraxisError('MCP_RESOURCE_TEMPLATE_INVALID', '服务器提供了不支持的资源模板。');
  }
  const names = template.variableNames;
  assert(
    args &&
      Object.keys(args).length <= 32 &&
      Object.keys(args).every((name) => names.includes(name)) &&
      names.every((name) => Object.hasOwn(args, name)),
    'INVALID_ARGUMENT',
    '模板参数必须与已发现的变量一致。',
  );
  const uri = template.expand(args);
  assert(Buffer.byteLength(uri) <= 4096, 'MCP_RESOURCE_LIMIT', '展开后的资源 URI 过长。');
  return uri;
}
export function resourceContent(raw: unknown) {
  assert(
    Buffer.byteLength(JSON.stringify(raw)) <= 2 * 1024 * 1024,
    'MCP_RESULT_LIMIT',
    '资源内容超过 2 MiB。',
  );
  const parsed = z
    .object({
      contents: z
        .array(
          z.object({
            uri: z.string().min(1).max(4096),
            mimeType: z.string().max(256).optional(),
            text: z.string().optional(),
            blob: z.string().optional(),
          }),
        )
        .max(1000),
    })
    .parse(raw);
  const contents = parsed.contents.flatMap(({ uri, mimeType, text }) =>
    text !== undefined ? [{ uri, ...(mimeType !== undefined ? { mimeType } : {}), text }] : [],
  );
  const unsupportedContent = parsed.contents
    .filter((c) => c.blob !== undefined || c.text === undefined)
    .map(({ uri, mimeType }) => ({
      uri,
      ...(mimeType !== undefined ? { mimeType } : {}),
      type: 'binary-or-unknown',
    }));
  return {
    contents,
    unsupportedContent,
    contentHash: fingerprint({ contents, unsupportedContent }),
  };
}
