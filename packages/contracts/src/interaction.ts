import { z } from 'zod';
export const questionSchema = z.strictObject({
  id: z.string().min(1).max(4096),
  prompt: z.string().min(1).max(4096),
  options: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(4096),
        label: z.string().min(1).max(4096),
        description: z.string().max(4096).optional(),
      }),
    )
    .min(2)
    .max(10)
    .optional(),
});

export const answersSchema = z
  .array(
    z.strictObject({
      id: z.string(),
      selectedOptionId: z.string().optional(),
      text: z.string().max(16384).optional(),
      skipped: z.boolean().default(false),
    }),
  )
  .min(1)
  .max(12);

export const pendingQuestionSchema = z.object({
  questionId: z.string(),
  turnId: z.string(),
  questions: z.array(questionSchema).min(1).max(12),
});
export type PendingQuestion = z.infer<typeof pendingQuestionSchema>;
export type QuestionAnswer = z.infer<typeof answersSchema>[number];
export const eventSchema = z.object({
  eventId: z.string(),
  sessionId: z.string(),
  seq: z.number().int().nonnegative(),
  schemaVersion: z.literal(1),
  type: z.string(),
  source: z.enum(['user', 'model', 'host', 'tool']),
  timestamp: z.string(),
  payload: z.record(z.string(), z.unknown()),
});
export const deltaSchema = z.object({ text: z.string() });
