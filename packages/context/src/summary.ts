import { z } from 'zod';

export const summarySchema = z.strictObject({
  objective: z.string(),
  requirements: z.array(z.string()),
  decisions: z.array(z.string()),
  completed: z.array(z.string()),
  active: z.array(z.string()),
  blocked: z.array(z.string()),
  files: z.array(z.string()),
  executions: z.array(z.string()),
  nextActions: z.array(z.string()),
  unresolvedQuestions: z.array(z.string()),
});
