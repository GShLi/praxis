import { z } from 'zod';
import { diagnosticCodeSchema } from './codes.ts';

const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const diagnosticInputSchema = z.strictObject({
  component: z.enum(['host', 'server', 'runtime', 'model', 'mcp', 'files']),
  kind: z.enum(['lifecycle', 'request', 'turn', 'generation', 'tool', 'compaction', 'cleanup']),
  phase: z.enum(['started', 'finished', 'error', 'cancelled']),
  sessionId: z.uuid().optional(),
  turnId: z.uuid().optional(),
  requestId: z.uuid().optional(),
  attemptId: z.uuid().optional(),
  executionId: z.uuid().optional(),
  code: diagnosticCodeSchema.optional(),
  status: z
    .enum(['running', 'completed', 'cancelled', 'failed', 'interrupted', 'unknown'])
    .optional(),
  durationMs: counter.optional(),
  steps: counter.optional(),
  attempts: counter.optional(),
  tools: counter.optional(),
  inputTokens: counter.optional(),
  outputTokens: counter.optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
});
export type DiagnosticInput = z.infer<typeof diagnosticInputSchema>;
export const diagnosticRecordSchema = diagnosticInputSchema.extend({
  version: z.literal(1),
  id: z.uuid(),
  timestamp: z.iso.datetime(),
});
export type DiagnosticRecord = z.infer<typeof diagnosticRecordSchema>;
export const retentionSchema = z.strictObject({
  maxFileBytes: z
    .number()
    .int()
    .min(1024)
    .max(50 * 1024 * 1024)
    .default(50 * 1024 * 1024),
  maxFiles: z.number().int().min(1).max(5).default(5),
  maxAgeMs: z
    .number()
    .int()
    .min(60000)
    .max(14 * 86400000)
    .default(14 * 86400000),
  queueLimit: z.number().int().min(1).max(256).default(256),
});
export type DiagnosticRetention = z.infer<typeof retentionSchema>;
export const MAX_EXPORT_BYTES = 2 * 1024 * 1024;
export const MAX_EXPORT_RECORDS = 5000;
