import { userInstructionMaterial } from '@praxis/context';
import type { ModelConfig, Session } from '@praxis/contracts';
import type { SessionStore } from '@praxis/storage-local';
import type { Active, RuntimeOptions } from './types.ts';

export async function snapshotUserInstructions(
  store: SessionStore,
  session: Session,
  turn: Active,
  options: RuntimeOptions,
  config: ModelConfig,
) {
  if (!options.userInstructions) return;
  const material = userInstructionMaterial(
    await options.userInstructions(session.ownerUserId, turn.controller.signal),
    [config.apiKey],
  );
  turn.controller.signal.throwIfAborted();
  store.transaction(() => {
    const contentObjectId = material.messages.length
      ? store.artifact(session.id, 'user-instruction', material.text)
      : null;
    store.append(session.id, 'user-instructions/snapshot', {
      turnId: turn.id,
      sourceType: 'user-settings',
      revision: material.revision,
      hash: material.hash,
      enabled: material.enabled,
      contentObjectId,
    });
  });
  turn.userInstructions = material;
}
