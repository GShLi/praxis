import { userInstructionMaterial } from '@praxis/context';
import type { ModelConfig, UserInstructionSettings } from '@praxis/contracts';
import type { ChatContextServices } from './context-types.ts';
import type { Running } from './types.ts';

export interface UserInstructionOptions {
  userInstructions?:
    | ((owner: string, signal: AbortSignal) => Promise<UserInstructionSettings>)
    | undefined;
}
export async function snapshotUserInstructions(
  services: ChatContextServices & UserInstructionOptions,
  run: Running,
  config: ModelConfig,
) {
  if (!services.userInstructions) return [];
  const material = userInstructionMaterial(
    await services.userInstructions(run.owner, run.controller.signal),
    [config.apiKey],
  );
  run.controller.signal.throwIfAborted();
  await services.append(run.chatId, 'user-instructions/snapshot', {
    generationId: run.id,
    sourceType: 'user-settings',
    revision: material.revision,
    hash: material.hash,
    enabled: material.enabled,
    content: material.text,
  });
  return material.messages;
}
