import { fingerprint } from '@praxis/config';
import { assert } from '@praxis/contracts';
import type { JsonSchema } from '@praxis/schema';
import { compileSchema } from '@praxis/schema';
import type { CatalogTool } from './catalog-types.ts';

export const modelToolName = (serverId: string, namespace: string, rawName: string) => {
  const safe = (value: string, max: number) =>
    value.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, max) || 'tool';
  return `mcp__${safe(namespace, 12)}__${safe(rawName, 32)}_${fingerprint([serverId, rawName]).slice(0, 12)}`;
};

export function encodeHeader(value: string | number | boolean) {
  const text = String(value);
  return !/^[\x20-\x7e]*$/.test(text) ||
    text.trim() !== text ||
    (text.startsWith('=?base64?') && text.endsWith('?='))
    ? `=?base64?${Buffer.from(text).toString('base64')}?=`
    : text;
}

export function prepareSchema(raw: unknown) {
  const paths: CatalogTool['headerPaths'] = [],
    names = new Set<string>();
  const visit = (value: unknown, parts: string[] | null, depth: number): unknown => {
    assert(depth < 24, 'MCP_SCHEMA_UNSUPPORTED', 'Schema 嵌套超限。');
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((entry) => visit(entry, null, depth + 1));
    const schema = value as JsonSchema,
      copy: JsonSchema = Object.create(null) as JsonSchema;
    for (const [key, entry] of Object.entries(schema)) {
      if (key === 'x-mcp-header') {
        assert(
          parts &&
            parts.length &&
            typeof entry === 'string' &&
            /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(entry) &&
            !names.has(entry.toLowerCase()) &&
            ['integer', 'string', 'boolean'].includes(String(schema.type)),
          'MCP_SCHEMA_UNSUPPORTED',
          '参数镜像 Header 注解无效。',
        );
        names.add(entry.toLowerCase());
        paths.push({ name: `Mcp-Param-${entry}`, path: parts });
      } else if (
        key === 'properties' &&
        entry &&
        typeof entry === 'object' &&
        !Array.isArray(entry)
      ) {
        copy[key] = Object.fromEntries(
          Object.entries(entry).map(([name, child]) => [
            name,
            visit(child, parts ? [...parts, name] : null, depth + 1),
          ]),
        );
      } else if (
        [
          'items',
          'additionalProperties',
          'anyOf',
          'allOf',
          'oneOf',
          '$defs',
          'definitions',
        ].includes(key)
      )
        copy[key] = visit(entry, null, depth + 1);
      else copy[key] = entry;
    }
    return copy;
  };
  const compiled = compileSchema(visit(raw, [], 0));
  assert(
    compiled.schema.type === 'object',
    'MCP_SCHEMA_UNSUPPORTED',
    'MCP 工具参数根必须是 object。',
  );
  return { ...compiled, headerPaths: paths };
}

export function argumentHeaders(tool: CatalogTool, input: unknown) {
  tool.validate(input);
  const headers: Record<string, string> = {};
  for (const item of tool.headerPaths) {
    let value = input;
    for (const part of item.path) {
      value =
        value && typeof value === 'object' && Object.hasOwn(value, part)
          ? (value as Record<string, unknown>)[part]
          : undefined;
    }
    if (value === undefined || value === null) continue;
    assert(
      ['string', 'boolean', 'number'].includes(typeof value) &&
        (typeof value !== 'number' || Number.isSafeInteger(value)),
      'MCP_RESPONSE_INVALID',
      'Header 参数不是支持的原始值。',
    );
    headers[item.name] = encodeHeader(value as string | number | boolean);
  }
  return headers;
}
