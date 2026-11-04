import { useEffect, useState } from 'react';
import type { PraxisClient } from '../client-types.ts';
import { useSettingsResource } from './useSettingsResource.ts';

export function useMcpSettings(client: PraxisClient) {
  const resource = useSettingsResource(
    client,
    client.mcpServers ? () => client.mcpServers!() : undefined,
  );
  const [checked, setChecked] = useState<Record<string, number>>({});
  useEffect(() => setChecked({}), [client]);
  const revision = () => {
    if (!resource.data) throw new Error('请先读取连接配置。');
    return resource.data.revision;
  };
  const mutate = (id: string, operation: () => Promise<string>) =>
    resource.run(async () => {
      setChecked({});
      return operation();
    }, id);
  return {
    ...resource,
    state: resource.data,
    checked,
    refresh: async () => {
      setChecked({});
      return resource.reload();
    },
    check: async (id: string, configRevision: number) => {
      setChecked((values) => {
        const next = { ...values };
        delete next[id];
        return next;
      });
      const done = await resource.run(
        async () => {
          if (!client.testMcp) throw new Error('此客户端不支持检查连接。');
          const result = await client.testMcp(id, configRevision);
          return `连接成功 · 协议 ${result.protocol} · ${result.toolCount} 个兼容工具 · ${result.rejectedTools} 个不兼容工具。可以启用 Agent 工具。`;
        },
        id,
        false,
      );
      if (done) setChecked((values) => ({ ...values, [id]: configRevision }));
      return done;
    },
    enable: (id: string, configRevision: number) =>
      mutate(id, async () => {
        if (!client.enableMcp) throw new Error('此客户端不支持启用连接。');
        await client.enableMcp(id, revision(), configRevision);
        return '已启用。Agent 可发现工具，业务调用每次需要你确认发送的参数。';
      }),
    disable: (id: string) =>
      mutate(id, async () => {
        if (!client.disableMcp) throw new Error('此客户端不支持停用连接。');
        await client.disableMcp(id, revision());
        return '已停用，相关操作已取消。';
      }),
    setBearer: (id: string, configRevision: number, token: string) =>
      mutate(id, async () => {
        if (!client.setMcpBearer) throw new Error('此客户端不支持保存凭据。');
        await client.setMcpBearer(id, revision(), configRevision, token);
        return '凭据已保存。请重新检查连接，再启用服务器。';
      }),
    clearCredential: (id: string, configRevision: number) =>
      mutate(id, async () => {
        if (!client.clearMcpCredential) throw new Error('此客户端不支持清除凭据。');
        await client.clearMcpCredential(id, revision(), configRevision);
        return '本地凭据已清除，连接已停用。远端 Token 未撤销。';
      }),
    remove: (id: string, configRevision: number) =>
      mutate(id, async () => {
        if (!client.deleteMcp) throw new Error('此客户端不支持删除连接。');
        await client.deleteMcp(id, revision(), configRevision);
        return '连接和本地凭据已删除。远端授权未撤销。';
      }),
    save: (config: unknown, configRevision: number | null = null) =>
      mutate('editor', async () => {
        if (!client.saveMcp) throw new Error('此客户端不支持保存连接。');
        await client.saveMcp(config, revision(), configRevision);
        return '连接已保存，请先检查连接。';
      }),
  };
}
