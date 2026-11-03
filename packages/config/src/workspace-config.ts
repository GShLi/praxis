import { assert, PraxisError, workspaceConfigSchema } from '@praxis/contracts';
import { fingerprint } from './fingerprint.ts';

/** This parser receives only the explicitly named workspace file, never executable config. */
export function parseWorkspaceConfig(text: string | null, knownSecrets: readonly string[] = []) {
  if (text === null)
    return {
      value: workspaceConfigSchema.parse({ schemaVersion: 1 }),
      hash: fingerprint(null),
      present: false,
    };
  assert(
    Buffer.byteLength(text) <= 32 * 1024,
    'WORKSPACE_CONFIG_LIMIT',
    '工作区配置不能超过 32 KiB。',
  );
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PraxisError('WORKSPACE_CONFIG_INVALID', '.praxis/config.json 不是有效 JSON。');
  }
  const parsed = workspaceConfigSchema.safeParse(raw);
  if (!parsed.success) {
    // Report only a schema-owned field path; unknown names or values may themselves be secrets.
    const issue = parsed.error.issues[0];
    const field =
      issue?.path
        .filter(
          (part) =>
            typeof part === 'number' ||
            [
              'schemaVersion',
              'ignore',
              'context',
              'language',
              'responseStyle',
              'validationCommands',
            ].includes(String(part)),
        )
        .join('.') || '$';
    throw new PraxisError(
      'WORKSPACE_CONFIG_INVALID',
      `.praxis/config.json 的 ${field} 含未知字段或无效值。`,
    );
  }
  const encoded = JSON.stringify(parsed.data);
  assert(
    !knownSecrets.some((secret) => secret && encoded.includes(JSON.stringify(secret).slice(1, -1))),
    'WORKSPACE_CONFIG_SECRET',
    '工作区配置包含受保护凭据，请从项目文件移除。',
  );
  return { value: parsed.data, hash: fingerprint(raw), present: true };
}
