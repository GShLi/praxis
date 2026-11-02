import type { JsonSchema } from '../../schema/src/index.ts';
import type { ModelClient } from '../../model-core/src/index.ts';

export interface PluginServices {
  readonly signal: AbortSignal;
  /** Delegates to the same scoped core executor and permission checks as built-in tools. */
  invokeCore(modelName: string, arguments_: Record<string, unknown>): Promise<unknown>;
}
export interface PluginTool {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute(input: unknown, services: PluginServices): Promise<unknown>;
}
export interface PluginContext {
  readonly pluginId: string;
  readonly mode: 'chat' | 'agent';
  registerTool(tool: PluginTool): void;
  registerProvider(id: string, provider: ModelClient): void;
  registerCommand(
    name: string,
    command: (input: unknown, services: PluginServices) => Promise<unknown>,
  ): void;
  contributeContext(contributor: () => Promise<string>): void;
  beforeExecute(check: (tool: string, input: unknown) => Promise<'deny' | 'ask' | 'pass'>): void;
  onTurnFinished(callback: (sessionId: string) => Promise<void>): void;
  onDispose(cleanup: () => void | Promise<void>): void;
}
export interface PraxisPlugin {
  activate(context: PluginContext): void | Promise<void>;
}
