import { z } from 'zod';
import { permissionSchema } from './protocol.ts';
import { workspaceMcpSchema } from './workspace-mcp.ts';

const singleLine = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[^\x00-\x1f\x7f]+$/);
export const workspaceConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  mcp: workspaceMcpSchema.optional(),
  ignore: z.array(singleLine(512)).max(128).default([]),
  context: z
    .strictObject({
      language: z.enum(['auto', 'zh-CN', 'en']).default('auto'),
      responseStyle: z.enum(['auto', 'concise', 'detailed']).default('auto'),
    })
    .prefault({}),
  validationCommands: z.array(singleLine(2048)).max(16).default([]),
});
export type WorkspaceConfig = z.infer<typeof workspaceConfigSchema>;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const effectiveConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision: z.number().int().positive(),
  hash: digest,
  sources: z
    .array(
      z.strictObject({
        kind: z.enum(['host', 'workspace', 'session', 'provider', 'user-instructions']),
        revision: z.number().int().nonnegative().optional(),
        hash: digest,
        path: z.string().optional(),
        present: z.boolean().optional(),
      }),
    )
    .max(5),
  values: z.strictObject({
    workspace: workspaceConfigSchema.nullable(),
    budgets: z.strictObject({
      steps: z.number().int().nonnegative(),
      tools: z.number().int().nonnegative(),
      attempts: z.number().int().nonnegative(),
      timeoutMs: z.number().int().positive(),
    }),
    permission: permissionSchema,
    provider: z
      .strictObject({
        id: z.string(),
        revision: z.number().int().positive(),
        model: z.string(),
        adapter: z.string(),
        contextWindow: z.number().int().positive(),
        maxOutputTokens: z.number().int().positive(),
      })
      .nullable(),
    plugins: z.array(z.strictObject({ id: z.string(), version: z.string(), digest: z.string() })),
    userInstructions: z
      .strictObject({ revision: z.number().int().nonnegative(), hash: digest })
      .nullable(),
  }),
});
export type EffectiveConfig = z.infer<typeof effectiveConfigSchema>;
