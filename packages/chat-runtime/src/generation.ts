import type { ModelConfig } from '@praxis/contracts';
import { assert, safeError } from '@praxis/contracts';
import type { ChatContextServices } from './context.ts';
import { buildChatContext } from './context.ts';
import type { Running } from './types.ts';
export interface GenerationServices extends ChatContextServices {
  beginUse: (owner: string, providerId: string, signal: AbortSignal) => Promise<ModelConfig>;
  emit: (name: string, payload: unknown) => void;
}
export async function generateChat(
  services: GenerationServices,
  run: Running,
  providerId: string,
  inputId: string,
) {
  const timer = setTimeout(() => run.controller.abort(), 600_000);
  let status = 'completed';
  let usage: unknown;
  let save: Promise<unknown> | undefined;
  let previous = '';
  const partialTimer = setInterval(() => {
    if (!save && previous !== run.content) {
      previous = run.content;
      save = services.database
        .query("UPDATE chat_generations SET content=$1 WHERE id=$2 AND status='running'", [
          run.content,
          run.id,
        ])
        .catch(() => run.controller.abort())
        .finally(() => {
          save = undefined;
        });
    }
  }, 500);
  try {
    const config = await services.beginUse(run.owner, providerId, run.controller.signal);
    const messages = await buildChatContext(services, run, config, inputId);
    await services.append(run.chatId, 'request/snapshot', {
      generationId: run.id,
      messages,
      tools: [],
      providerId,
      configRevision: config.revision,
      model: config.model,
    });
    const response = await services.model.complete({
      messages,
      tools: [],
      config,
      purpose: 'chat_generation',
      signal: run.controller.signal,
      onDelta: (text) => {
        run.content += text;
        services.emit('delta', { sessionId: run.chatId, generationId: run.id, text });
      },
    });
    assert(!response.message.toolCalls?.length, 'UNEXPECTED_TOOL_CALL', 'ChatBot 不能调用工具。');
    run.controller.signal.throwIfAborted();
    run.content = response.message.content;
    usage = response.usage;
  } catch (error) {
    status = run.controller.signal.aborted ? 'interrupted' : 'failed';
    await services.append(run.chatId, 'generation/error', {
      generationId: run.id,
      ...safeError(error),
    });
  } finally {
    clearTimeout(timer);
    clearInterval(partialTimer);
    await save;
    const event = await services.database.transaction(async (sql) => {
      await services.repository.owned(run.owner, run.chatId, sql, true);
      await sql.query('UPDATE chat_generations SET status=$1,content=$2 WHERE id=$3', [
        status,
        run.content,
        run.id,
      ]);
      if (status === 'completed')
        await sql.query('UPDATE chat_inputs SET selected_generation=$1 WHERE id=$2', [
          run.id,
          inputId,
        ]);
      await sql.query(
        'UPDATE chats SET active_generation=NULL WHERE id=$1 AND active_generation=$2',
        [run.chatId, run.id],
      );
      const event = await services.repository.event(
        sql,
        run.chatId,
        'generation/finished',
        { generationId: run.id, inputId, status, content: run.content, usage: usage ?? null },
        'model',
      );
      await sql.query('INSERT INTO chat_checkpoints VALUES($1,$2,$3)', [
        run.chatId,
        event.seq,
        JSON.stringify({ throughSeq: event.seq, generationId: run.id, inputId, status }),
      ]);
      return event;
    });
    services.emit('event', event);
  }
}
