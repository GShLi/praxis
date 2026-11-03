import { z } from 'zod';
export const MAX_BACKUP_BYTES = 2 * 1024 * 1024 * 1024;
export const backupIdentitySchema = z.strictObject({
  ownerUserId: z.string().min(1).max(1024),
  clientKind: z.enum(['cli', 'desktop']),
  serverUrl: z
    .string()
    .url()
    .max(4096)
    .refine((raw) => {
      const url = new URL(raw);
      return (
        ['https:', 'http:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        url.pathname === '/'
      );
    })
    .transform((raw) => new URL(raw).href),
});
export type BackupIdentity = z.infer<typeof backupIdentitySchema>;
export const backupCountsSchema = z.strictObject({
  sessions: z.number().int().nonnegative(),
  events: z.number().int().nonnegative(),
  inputs: z.number().int().nonnegative(),
  messages: z.number().int().nonnegative(),
  contexts: z.number().int().nonnegative(),
  checkpoints: z.number().int().nonnegative(),
  artifacts: z.number().int().nonnegative(),
  requests: z.number().int().nonnegative(),
  maintenance_operations: z.number().int().nonnegative(),
});
export const backupManifestSchema = z.strictObject({
  format: z.literal('praxis-local-backup'),
  version: z.literal(1),
  storageVersion: z.union([z.literal(2), z.literal(3)]),
  identity: backupIdentitySchema,
  createdAt: z.iso.datetime(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive().max(MAX_BACKUP_BYTES),
  counts: backupCountsSchema,
});
export type BackupManifest = z.infer<typeof backupManifestSchema>;
export const databaseTaskSchema = z.strictObject({
  mode: z.enum(['snapshot', 'inspect', 'restore']),
  source: z.string().min(1),
  destination: z.string().optional(),
  owner: z.string().min(1),
});
export type DatabaseTask = z.infer<typeof databaseTaskSchema>;
