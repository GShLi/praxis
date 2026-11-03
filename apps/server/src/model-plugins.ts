import { assert } from '@praxis/contracts';
import { DeepSeekClient, type ModelClient } from '@praxis/model-core';
import { PluginHost, PluginInstaller, resolvePluginModel } from '@praxis/plugin-host';
import { stat } from 'node:fs/promises';
import path from 'node:path';

/** Only an operator-supplied, already installed registry is read. HTTP cannot install server code. */
export async function serverModels(directory = process.env.PRAXIS_SERVER_PLUGIN_DIRECTORY) {
  const host = new PluginHost(new Set(), 'chat', 10000, 'server');
  const fallback = new DeepSeekClient();
  try {
    if (directory) {
      assert(
        path.isAbsolute(directory),
        'PLUGIN_DIRECTORY_INVALID',
        '服务端插件目录须为绝对路径。',
      );
      assert(
        (await stat(directory)).isDirectory(),
        'PLUGIN_DIRECTORY_INVALID',
        '服务端插件目录不存在。',
      );
      const installer = new PluginInstaller(directory);
      for (const record of (await installer.records.read()).value)
        if (record.enabled) await host.load(installer, record);
    }
    const plugins = host.snapshot();
    const model: ModelClient = {
      complete: (request) =>
        resolvePluginModel(plugins, request.config, fallback).model.complete(request),
    };
    return { model, close: () => host.dispose() };
  } catch (error) {
    await host.dispose();
    throw error;
  }
}
