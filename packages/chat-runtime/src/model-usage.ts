import { CalibratedModel, calibrationScope } from '@praxis/context';
import type { ModelConfig } from '@praxis/contracts';
import type { ChatContextServices } from './context-types.ts';
import type { Running } from './types.ts';

/** The active generation owns the model; durable records remain scoped to its chat. */
export async function chatCalibratedModel(
  services: ChatContextServices,
  run: Running,
  config: ModelConfig,
) {
  const previous = await services.repository.latestEvent(
    run.chatId,
    'model/usage',
    calibrationScope(config),
  );
  return new CalibratedModel(services.model, config, previous?.payload, async (payload) => {
    await services.append(run.chatId, 'model/usage', { ...payload, generationId: run.id }, 'model');
  });
}
