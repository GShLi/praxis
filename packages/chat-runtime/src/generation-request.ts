import { completeWithContextRecovery } from '@praxis/context';
import type { ModelConfig } from '@praxis/contracts';
import type { ChatContextServices } from './context-types.ts';
import { buildChatContext } from './context.ts';
import type { Running } from './types.ts';
import { snapshotUserInstructions, type UserInstructionOptions } from './user-instructions.ts';

export interface GenerationServices extends ChatContextServices, UserInstructionOptions {
  beginUse: (owner: string, providerId: string, signal: AbortSignal) => Promise<ModelConfig>;
}
export async function requestGeneration(
  services: GenerationServices,
  run: Running,
  providerId: string,
  inputId: string,
) {
  const config = await services.beginUse(run.owner, providerId, run.controller.signal);
  run.controller.signal.throwIfAborted();
  const personal = await snapshotUserInstructions(services, run, config);
  return completeWithContextRecovery(services.model, async (force) => {
    if (force)
      await services.append(run.chatId, 'context/overflow-recovery', { generationId: run.id });
    const { messages, version } = await buildChatContext(
      services,
      run,
      config,
      inputId,
      personal,
      force,
    );
    await services.append(run.chatId, 'request/snapshot', {
      generationId: run.id,
      messages,
      tools: [],
      providerId,
      configRevision: config.revision,
      model: config.model,
      adapter: config.adapter ?? 'openai-compatible',
      contextVersion: version,
    });
    return {
      contextVersion: version,
      request: {
        messages,
        tools: [],
        config,
        purpose: 'chat_generation',
        signal: run.controller.signal,
        onDelta: (text: string) => {
          run.content += text;
          services.emit('delta', { sessionId: run.chatId, generationId: run.id, text });
        },
      },
    };
  });
}
