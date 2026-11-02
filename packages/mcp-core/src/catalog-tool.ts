import { fingerprint } from '@praxis/config';
import { assert } from '@praxis/contracts';
import { compileSchema } from '@praxis/schema';
import { z } from 'zod';
import type { CatalogBinding, CatalogTool } from './catalog-types.ts';
import { modelToolName, prepareSchema } from './tool-schema.ts';
export function catalogTool(
  entry: { name: string; [key: string]: unknown },
  binding: CatalogBinding,
  namespace: string,
  modelNames: Set<string>,
): CatalogTool {
  assert(
    !entry.execution || (entry.execution as { taskSupport?: string }).taskSupport !== 'required',
    'MCP_CAPABILITY_UNSUPPORTED',
    '此工具要求后台 Tasks。',
  );
  const schema = prepareSchema(entry.inputSchema),
    name = modelToolName(binding.serverId, namespace, entry.name);
  assert(!modelNames.has(name), 'MCP_NAME_COLLISION', '模型工具名摘要碰撞。');
  modelNames.add(name);
  const description = z
    .string()
    .max(16384)
    .parse(entry.description ?? '');
  const outputSchema =
    entry.outputSchema === undefined ? undefined : compileSchema(entry.outputSchema).schema;
  return {
    id: JSON.stringify([binding.serverId, entry.name]),
    rawName: entry.name,
    modelName: name,
    description,
    parameters: schema.schema,
    inputHash: fingerprint(entry.inputSchema),
    wireParameters: structuredClone(entry.inputSchema) as Record<string, unknown>,
    headerPaths: schema.headerPaths,
    validate: schema.validate,
    ...(outputSchema ? { outputSchema } : {}),
  };
}
