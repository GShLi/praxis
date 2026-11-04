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
  sessionTitleSchema,
  sessionListSchema,
  sessionRenameSchema,
  sessionArchiveSchema,
  sessionHistoryUpdateSchema,
} from './session-history.ts';
export type { SessionHistoryUpdate } from './session-history.ts';
export {
  userInstructionsSchema,
  userInstructionSettingsSchema,
  saveUserInstructionsSchema,
} from './user-instructions.ts';
export type { UserInstructionSettings, SaveUserInstructions } from './user-instructions.ts';
export { workspaceConfigSchema, effectiveConfigSchema } from './workspace-config.ts';
export type { WorkspaceConfig, EffectiveConfig } from './workspace-config.ts';
export { workspaceMcpSchema } from './workspace-mcp.ts';
export type { WorkspaceMcpConfig } from './workspace-mcp.ts';
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
