import { z } from 'zod';

export const userInstructionsSchema = z.strictObject({
  enabled: z.boolean(),
  text: z
    .string()
    .max(16384)
    .refine(
      (value) => !value.includes('\0') && new TextEncoder().encode(value).byteLength <= 16384,
      '用户指令最多 16 KiB，不能包含 NUL。',
    ),
});
export const userInstructionSettingsSchema = z.strictObject({
  revision: z.number().int().min(0).max(2147483647),
  value: userInstructionsSchema,
});
export const saveUserInstructionsSchema = z.strictObject({
  expectedRevision: z.number().int().min(0).max(2147483646),
  value: userInstructionsSchema,
});
export type UserInstructionSettings = z.infer<typeof userInstructionSettingsSchema>;
export type SaveUserInstructions = z.infer<typeof saveUserInstructionsSchema>;
