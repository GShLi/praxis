export { PraxisError, assert, safeError } from './errors.ts';
export {
  MAX_FRAME_BYTES,
  PROTOCOL,
  idSchema,
  initializeSchema,
  permissionSchema,
  promptSchema,
  textSchema,
} from './protocol.ts';
export type { Permission, Prompt } from './protocol.ts';
export type {
  Event,
  Json,
  Kind,
  Message,
  ModelConfig,
  Session,
  ToolCall,
  ToolDefinition,
  ToolResult,
  TurnStatus,
} from './types.ts';

export {
  questionSchema,
  answersSchema,
  pendingQuestionSchema,
  eventSchema,
  deltaSchema,
} from './interaction.ts';
export type { PendingQuestion, QuestionAnswer } from './interaction.ts';
export { userCommandSchema } from './user-command.ts';
export type { UserCommand } from './user-command.ts';
export {
  mcpPromptEntrySchema,
  mcpPromptGetSchema,
  mcpPromptApplySchema,
  mcpPromptPreviewSchema,
} from './mcp-prompts.ts';
export { mcpOAuthStartSchema } from './mcp-oauth.ts';
export type { McpOAuthStart, McpOAuthStarted, McpOAuthStatus } from './mcp-oauth.ts';
export type {
  McpPromptEntry,
  McpPromptList,
  McpPromptGet,
  McpPromptApply,
  McpPromptPreview,
} from './mcp-prompts.ts';
