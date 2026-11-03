import { z } from 'zod';

// Fixed vocabulary: plugin/remote codes are data and may contain private text.
export const diagnosticCodeSchema = z.enum([
  'UNCLASSIFIED_ERROR',
  'INTERNAL_ERROR',
  'INVALID_ARGUMENT',
  'UNAUTHENTICATED',
  'AUTH_FAILED',
  'FORBIDDEN',
  'CSRF_FAILED',
  'RATE_LIMITED',
  'BODY_TOO_LARGE',
  'CANCELLED',
  'TIMEOUT',
  'SESSION_BUSY',
  'STORAGE_FAILURE',
  'DISK_FULL',
  'DIAGNOSTICS_WRITE_FAILED',
  'EXECUTION_CLEANUP_UNKNOWN',
  'MODEL_UNAVAILABLE',
  'MODEL_HTTP_ERROR',
  'MODEL_NETWORK_ERROR',
  'MODEL_CONTEXT_OVERFLOW',
  'MODEL_PROTOCOL_ERROR',
  'TOOL_FAILED',
  'FILE_CHANGED',
  'FILE_PUBLISH_UNKNOWN',
  'INSTRUCTIONS_CHANGED',
  'PERMISSION_DENIED',
  'APPROVAL_REQUIRED',
  'MCP_UNAVAILABLE',
  'MCP_TIMEOUT',
  'MCP_AUTH_REQUIRED',
  'PLUGIN_UNAVAILABLE',
]);
export function diagnosticCode(value: unknown) {
  if (value === undefined) return undefined;
  const parsed = diagnosticCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : 'UNCLASSIFIED_ERROR';
}
