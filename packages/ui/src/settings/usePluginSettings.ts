import type { PraxisClient } from '../client-types.ts';
import { useSettingsResource } from './useSettingsResource.ts';

export function usePluginSettings(client: PraxisClient) {
  const resource = useSettingsResource(
    client,
    client.plugins ? () => client.plugins!() : undefined,
  );
  const revision = () => {
    if (!resource.data) throw new Error('请先读取插件配置。');
    return resource.data.revision;
  };
  return {
    ...resource,
    install: (source: string, digest: string) =>
      resource.run(async () => {
        if (!client.installPlugin) throw new Error('此客户端不支持安装插件。');
        await client.installPlugin(source, digest, revision());
        return '插件已安装，默认停用。核对后可启用。';
      }, 'editor'),
    toggle: (id: string, enabled: boolean) =>
      resource.run(async () => {
        if (!client.enablePlugin) throw new Error('此客户端不支持更改插件状态。');
        await client.enablePlugin(id, enabled, revision());
        return enabled
          ? '插件已启用。新配置的生效时间见下方说明。'
          : '插件已停用。新配置的生效时间见下方说明。';
      }, id),
  };
}
