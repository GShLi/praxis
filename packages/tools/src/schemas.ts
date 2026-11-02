import { z } from 'zod';

export const shortText = z.string().min(1).max(4096);

export const scan = {
  path: z.string().max(4096).default('.'),
  includeHidden: z.boolean().default(false),
  respectIgnore: z.boolean().default(true),
};

export const planItem = z.strictObject({
  id: shortText,
  title: shortText,
  status: z.enum(['pending', 'in_progress', 'completed', 'blocked', 'cancelled']),
});

export const question = z.strictObject({
  id: shortText,
  prompt: shortText,
  options: z
    .array(
      z.strictObject({
        id: shortText,
        label: shortText,
        description: z.string().max(4096).optional(),
      }),
    )
    .min(2)
    .max(10)
    .optional(),
});

export const baseCommand = {
  cwd: z.string().max(4096).default('.'),
  description: shortText,
  timeoutMs: z.number().int().min(1).max(1_800_000).default(120_000),
  yieldMs: z.number().int().min(0).max(10_000).default(1000),
  env: z.record(z.string(), z.string()).default({}),
};

export const schemas = {
  fs_list: z.strictObject({
    path: z.string().max(4096).default('.'),
    includeHidden: z.boolean().default(false),
    limit: z.number().int().min(1).max(500).default(100),
    cursor: shortText.optional(),
  }),
  fs_find: z.strictObject({
    ...scan,
    pattern: shortText,
    limit: z.number().int().min(1).max(1000).default(200),
  }),
  fs_search: z.strictObject({
    ...scan,
    query: shortText,
    syntax: z.enum(['literal', 'regex']).default('literal'),
    include: z.array(shortText).max(50).default([]),
    caseSensitive: z.boolean().default(true),
    contextLines: z.number().int().min(0).max(5).default(0),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  fs_read: z.strictObject({
    path: shortText,
    startLine: z.number().int().min(1).default(1),
    lineCount: z.number().int().min(1).max(2000).default(200),
  }),
  fs_write: z.discriminatedUnion('mode', [
    z.strictObject({
      path: shortText,
      mode: z.literal('create'),
      content: z.string(),
      createParents: z.boolean().default(false),
    }),
    z.strictObject({
      path: shortText,
      mode: z.literal('replace'),
      content: z.string(),
      expectedVersion: shortText,
    }),
  ]),
  fs_apply_patch: z.strictObject({
    path: shortText,
    expectedVersion: shortText,
    edits: z
      .array(
        z.strictObject({
          oldText: z.string().min(1),
          newText: z.string(),
          expectedMatches: z.number().int().min(1).max(10000),
        }),
      )
      .min(1)
      .max(50),
  }),
  process_exec: z.discriminatedUnion('kind', [
    z.strictObject({
      ...baseCommand,
      kind: z.literal('exec'),
      executable: shortText,
      args: z.array(z.string().max(32_768)).max(256),
    }),
    z.strictObject({
      ...baseCommand,
      kind: z.literal('shell'),
      shell: z.enum(['bash', 'pwsh']),
      script: z.string().min(1).max(64_000),
    }),
  ]),
  process_read: z.strictObject({
    executionId: shortText,
    cursor: z.string().max(256).optional(),
    waitMs: z.number().int().min(0).max(10_000).default(0),
    maxBytes: z.number().int().min(1).max(65536).default(16384),
  }),
  process_list: z.strictObject({
    includeFinished: z.boolean().default(false),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  process_cancel: z.strictObject({
    executionId: shortText,
    reason: z.string().max(4096).optional(),
  }),
  task_update_plan: z.strictObject({
    expectedRevision: z.number().int().nonnegative(),
    items: z.array(planItem).max(100),
    explanation: z.string().max(8192).optional(),
  }),
  user_ask: z.strictObject({ questions: z.array(question).min(1).max(3) }),
  artifact_read: z.strictObject({
    artifactId: shortText,
    cursor: z.string().max(256).optional(),
    maxBytes: z.number().int().min(1).max(65536).default(16384),
  }),
};
