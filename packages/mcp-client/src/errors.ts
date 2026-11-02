import {
  InsufficientScopeError,
  SdkError,
  SdkErrorCode,
  UnauthorizedError,
  UnsupportedProtocolVersionError,
} from '@modelcontextprotocol/client';
import { PraxisError } from '@praxis/contracts';

export function mcpError(error: unknown, signal?: AbortSignal): PraxisError {
  if (error instanceof PraxisError) return error;
  if (signal?.aborted)
    return new PraxisError(
      signal.reason?.name === 'TimeoutError' ? 'MCP_OPERATION_TIMEOUT' : 'MCP_CANCELLED',
      'MCP 操作已超时或取消。',
    );
  if (error instanceof UnauthorizedError || error instanceof InsufficientScopeError)
    return new PraxisError('MCP_AUTH_REQUIRED', '服务器需要认证或更多权限；未自动认证或重试。');
  if (error instanceof UnsupportedProtocolVersionError)
    return new PraxisError('MCP_PROTOCOL_UNSUPPORTED', '服务器协议与 Praxis 支持的版本不兼容。');
  if (error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout)
    return new PraxisError('MCP_OPERATION_TIMEOUT', 'MCP 请求超时。');
  return new PraxisError('MCP_PROTOCOL_FAILED', 'MCP 协议请求失败；未自动重放业务请求。');
}
