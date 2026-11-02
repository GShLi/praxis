import { assert } from '@praxis/contracts';
import type { Catalog, CatalogTool } from './catalog-types.ts';

export class ToolSelector {
  private selected = new Map<string, CatalogTool>();
  private pending = new Map<string, CatalogTool>();
  private generations = new Map<string, string>();
  constructor(
    private tokenBudget: number,
    private maxTools = 32,
  ) {}
  discover(catalog: Catalog, query = '', limit = 5) {
    assert(
      !catalog.stale && limit >= 1 && limit <= 8,
      'MCP_CATALOG_STALE',
      '目录失效或发现数量无效。',
    );
    const old = this.generations.get(catalog.binding.serverId);
    assert(
      !old || old === catalog.generation,
      'MCP_CATALOG_CHANGED',
      '本轮固定目录已变化，请开始新任务轮次。',
    );
    this.generations.set(catalog.binding.serverId, catalog.generation);
    const found = catalog.tools
      .filter((tool) =>
        `${tool.rawName} ${tool.description}`.toLowerCase().includes(query.toLowerCase()),
      )
      .slice(0, limit);
    for (const tool of found) this.pending.set(tool.modelName, tool);
    return found.map(({ modelName, description, id }) => ({
      modelName,
      description,
      id,
      available: 'next-step',
    }));
  }
  boundary() {
    const excluded: string[] = [];
    for (const [name, tool] of this.pending) {
      const candidate = new Map(this.selected);
      candidate.set(name, tool);
      const bytes = Buffer.byteLength(
        JSON.stringify(
          [...candidate.values()].map(({ id, modelName, description, parameters }) => ({
            id,
            modelName,
            description,
            parameters,
          })),
        ),
      );
      if (candidate.size > this.maxTools || Math.ceil(bytes / 2) > Math.min(4000, this.tokenBudget))
        excluded.push(name);
      else this.selected = candidate;
    }
    this.pending.clear();
    return { tools: [...this.selected.values()], excluded };
  }
  resolve(name: string) {
    const tool = this.selected.get(name);
    assert(tool, 'TOOL_NOT_AVAILABLE', '该工具尚未出现在当前步骤的工具快照。');
    return tool;
  }
}
