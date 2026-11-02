import { ConfigFile } from '@praxis/config';
import { assert } from '@praxis/contracts';
import path from 'node:path';
import { z } from 'zod';
import type { McpConfig } from './config.ts';
import { validateConfig } from './config.ts';

/** Profile and owner scope come from the Host directory, never from imported JSON. */
export class McpConfigService {
  readonly file: ConfigFile<McpConfig[]>;
  constructor(
    directory: string,
    private invalidate: (serverId: string) => void,
  ) {
    this.file = new ConfigFile(
      path.join(directory, 'mcp.json'),
      (raw) => z.array(z.unknown()).max(8).parse(raw).map(validateConfig),
      [],
    );
  }
  async upsert(raw: unknown, expectedStoreRevision: number, expectedRevision: number | null) {
    const config = validateConfig(raw);
    const result = await this.file.update(expectedStoreRevision, (configs) => {
      const old = configs.find((value) => value.id === config.id);
      assert(
        old
          ? old.revision === expectedRevision && old.namespace === config.namespace
          : expectedRevision === null,
        'CONFIG_CONFLICT',
        '服务器版本或固定命名空间不匹配。',
      );
      assert(
        !configs.some((value) => value.id !== config.id && value.namespace === config.namespace),
        'MCP_NAMESPACE_CONFLICT',
        'MCP 命名空间已被占用。',
      );
      // An edit is a new draft. Connection/operation consent is never inherited from a changed config.
      return [
        ...configs.filter((value) => value.id !== config.id),
        { ...config, revision: (old?.revision ?? 0) + 1, enabled: false },
      ];
    });
    this.invalidate(config.id);
    return result;
  }
  async disable(serverId: string, expectedStoreRevision: number) {
    const result = await this.file.update(expectedStoreRevision, (configs) => {
      assert(
        configs.some((value) => value.id === serverId),
        'MCP_NOT_FOUND',
        '服务器不存在。',
      );
      return configs.map((value) =>
        value.id === serverId ? { ...value, enabled: false, revision: value.revision + 1 } : value,
      );
    });
    this.invalidate(serverId);
    return result;
  }
}
