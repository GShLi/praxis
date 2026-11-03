import { estimate } from '@praxis/context';
import type { Event } from '@praxis/contracts';
import type { ModelClient } from '@praxis/model-core';
import { z } from 'zod';

const summary = {
  objective: '继续',
  requirements: [],
  decisions: [],
  completed: [],
  active: [],
  blocked: [],
  files: [],
  executions: [],
  nextActions: [],
  unresolvedQuestions: [],
};
export function calibrationModel(multiplier: number) {
  const calls = { summaries: 0 };
  const model: ModelClient = {
    async complete(request) {
      if (request.purpose === 'compaction') calls.summaries++;
      return {
        message: {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: request.purpose === 'compaction' ? JSON.stringify(summary) : 'ok',
        },
        finishReason: 'stop',
        usage: { input: estimate([request.messages, request.tools]) * multiplier, output: 10 },
      };
    },
  };
  return { model, calls };
}
export function snapshotFactor(event: Event | undefined) {
  return z.object({ factor: z.number() }).parse(event?.payload.inputEstimate).factor;
}
