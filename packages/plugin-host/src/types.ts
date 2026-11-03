import type { ModelClient } from '@praxis/model-core';
import type { PluginCommand, PluginContext, PluginTool } from '@praxis/plugin-sdk';
import type { Manifest } from './manifest.ts';

export type ActivePlugin = {
  manifest: Manifest;
  digest: string;
  tools: ReadonlyMap<string, PluginTool>;
  providers: ReadonlyMap<string, ModelClient>;
  commands: ReadonlyMap<string, PluginCommand>;
  checks: Array<Parameters<PluginContext['beforeExecute']>[0]>;
  contributors: Array<Parameters<PluginContext['contributeContext']>[0]>;
  finished: Array<Parameters<PluginContext['onTurnFinished']>[0]>;
};
