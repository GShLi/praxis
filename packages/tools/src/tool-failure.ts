import { safeError, type ToolResult } from '@praxis/contracts';
export function recordToolFailure(
  result: ToolResult,
  error: unknown,
  cancelled: boolean,
  effect: boolean,
) {
  const safe =
    error instanceof SyntaxError
      ? { code: 'INVALID_ARGUMENT', safeMessage: '工具参数 JSON 无效。' }
      : safeError(error);
  result.status = cancelled
    ? 'cancelled'
    : ['ACCESS_DENIED', 'APPROVAL_REJECTED'].includes(safe.code)
      ? 'denied'
      : 'failed';
  result.error = { code: safe.code, message: safe.safeMessage };
  // Unknown errors after dispatch may follow a write; never claim a rollback.
  if (
    effect &&
    ![
      'FILE_NOT_OBSERVED',
      'FILE_VERSION_CONFLICT',
      'FILE_ALREADY_EXISTS',
      'PATCH_OVERLAP',
      'PATCH_MATCH_COUNT_MISMATCH',
      'SANDBOX_UNAVAILABLE',
      'ACCESS_DENIED',
      'INVALID_ARGUMENT',
      'FILE_TOO_LARGE',
    ].includes(safe.code)
  )
    result.effectState = 'unknown';
}
