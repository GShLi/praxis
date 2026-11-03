import { fingerprint } from '@praxis/config';
import {
  effectiveConfigSchema,
  assert,
  type EffectiveConfig,
  type ModelConfig,
  type Session,
} from '@praxis/contracts';
import type { ActivePlugin } from '@praxis/plugin-host';
import type { SessionStore } from '@praxis/storage-local';
import type { Active, RuntimeOptions } from './types.ts';

function freeze(value: object) {
  for (const nested of Object.values(value))
    if (nested && typeof nested === 'object') freeze(nested);
  Object.freeze(value);
}
function effectiveValues(
  session: Session,
  turn: Active,
  options: RuntimeOptions,
  plugins: readonly ActivePlugin[],
  config?: ModelConfig,
): EffectiveConfig['values'] {
  return {
    workspace: turn.workspaceConfig?.value ?? null,
    budgets: {
      steps: options.maxSteps ?? 100,
      tools: options.maxTools ?? 200,
      attempts: options.maxAttempts ?? 150,
      timeoutMs: Math.min(
        options.timeoutMs ?? 3_600_000,
        session.kind === 'chat' ? 600_000 : 3_600_000,
      ),
    },
    permission: session.permission,
    provider: config
      ? {
          id: config.id,
          revision: config.revision,
          model: config.model,
          adapter: config.adapter ?? 'openai-compatible',
          contextWindow: config.contextWindow,
          maxOutputTokens: config.maxOutputTokens,
        }
      : null,
    plugins: plugins.map((plugin) => ({
      id: plugin.manifest.id,
      version: plugin.manifest.version,
      digest: plugin.digest,
    })),
    userInstructions: turn.userInstructions
      ? { revision: turn.userInstructions.revision, hash: turn.userInstructions.hash }
      : null,
  };
}
export function snapshotEffectiveConfig(
  store: SessionStore,
  session: Session,
  turn: Active,
  options: RuntimeOptions,
  plugins: readonly ActivePlugin[],
  config?: ModelConfig,
) {
  const values = effectiveValues(store.get(session.id), turn, options, plugins, config);
  const sources: EffectiveConfig['sources'] = [
    { kind: 'host', revision: 1, hash: fingerprint(values.budgets) },
    { kind: 'session', revision: values.permission.revision, hash: fingerprint(values.permission) },
  ];
  if (turn.workspaceConfig)
    sources.push({
      kind: 'workspace',
      hash: turn.workspaceConfig.hash,
      path: '.praxis/config.json',
      present: turn.workspaceConfig.present,
    });
  if (values.provider)
    sources.push({
      kind: 'provider',
      revision: values.provider.revision,
      hash: fingerprint(values.provider),
    });
  if (values.userInstructions)
    sources.push({ kind: 'user-instructions', ...values.userInstructions });
  const hash = fingerprint({ sources, values });
  const previous = readEffectiveConfig(store, session.id);
  const revision = (previous?.revision ?? 0) + Number(previous?.hash !== hash);
  const snapshot = effectiveConfigSchema.parse({
    schemaVersion: 1,
    revision,
    hash,
    sources,
    values,
  });
  freeze(snapshot);
  store.append(session.id, 'config/effective', { ...snapshot, turnId: turn.id });
  turn.effectiveConfig = snapshot;
}
export function readEffectiveConfig(store: SessionStore, sessionId: string) {
  const event = store.latestEvent(sessionId, 'config/effective');
  if (!event) return null;
  const { turnId, ...snapshot } = event.payload;
  const parsed = effectiveConfigSchema.parse(snapshot);
  assert(
    fingerprint({ sources: parsed.sources, values: parsed.values }) === parsed.hash,
    'CONFIG_SNAPSHOT_CORRUPT',
    '配置快照摘要不匹配。',
  );
  return parsed;
}
