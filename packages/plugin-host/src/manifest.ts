import { z } from 'zod';

export const manifestSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/)
    .max(100),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  sdkVersion: z.literal('^1.0.0'),
  entry: z
    .string()
    .regex(/\.(?:mjs|js)$/)
    .max(512),
  runtimes: z.array(z.enum(['local-host', 'server'])).min(1),
  modes: z.array(z.enum(['chat', 'agent'])).min(1),
  capabilities: z.array(
    z.enum([
      'model-provider',
      'agent-tool',
      'user-command',
      'policy-check',
      'context-contributor',
      'lifecycle',
    ]),
  ),
  platforms: z.array(z.enum(['darwin', 'linux', 'win32'])).min(1),
});

export type Manifest = z.infer<typeof manifestSchema>;

export const recordSchema = z.strictObject({
  manifest: manifestSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  enabled: z.boolean(),
});

export const recordsSchema = z.array(recordSchema).max(32);

export type InstalledPlugin = z.infer<typeof recordSchema>;
