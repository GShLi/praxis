import type { Event } from '@praxis/contracts';
import { diagnosticCode } from './codes.ts';
import { diagnosticInputSchema, type DiagnosticInput } from './schema.ts';

const kinds: Record<
  string,
  [DiagnosticInput['component'], DiagnosticInput['kind'], DiagnosticInput['phase']]
> = {
  'turn/started': ['runtime', 'turn', 'started'],
  'turn/finished': ['runtime', 'turn', 'finished'],
  'turn/error': ['runtime', 'turn', 'error'],
  'generation/accepted': ['runtime', 'generation', 'started'],
  'generation/finished': ['runtime', 'generation', 'finished'],
  'generation/error': ['runtime', 'generation', 'error'],
  'request/snapshot': ['model', 'request', 'started'],
  'step/finished': ['model', 'request', 'finished'],
  'tool/intent': ['runtime', 'tool', 'started'],
  'tool/result': ['runtime', 'tool', 'finished'],
  'plugin/tool-result': ['runtime', 'tool', 'finished'],
  'context/compaction_started': ['runtime', 'compaction', 'started'],
  'context/compaction_committed': ['runtime', 'compaction', 'finished'],
  'execution/cleanup_unknown': ['runtime', 'cleanup', 'error'],
};
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
/** Explicit field projection, never spread a Session payload into diagnostic storage. */
export function projectDiagnosticEvent(event: Event): DiagnosticInput | undefined {
  if (!Object.hasOwn(kinds, event.type)) return undefined;
  const descriptor = kinds[event.type];
  if (!descriptor) return undefined;
  const [component, kind, phase] = descriptor;
  const payload = event.payload,
    result = object(payload.result),
    usage = object(payload.usage);
  const error = object(result.error);
  const parsed = diagnosticInputSchema.safeParse({
    component,
    kind,
    phase: result.error ? 'error' : phase,
    sessionId: event.sessionId,
    turnId: payload.turnId,
    attemptId: payload.attemptId ?? payload.generationId,
    executionId: result.callId ?? payload.callId,
    code:
      event.type === 'execution/cleanup_unknown'
        ? 'EXECUTION_CLEANUP_UNKNOWN'
        : diagnosticCode(payload.code ?? error.code),
    status: payload.status,
    durationMs: result.durationMs,
    steps: payload.steps,
    attempts: payload.attempts,
    tools: typeof payload.tools === 'number' ? payload.tools : undefined,
    inputTokens: usage.input,
    outputTokens: usage.output,
  });
  return parsed.success ? parsed.data : undefined;
}
