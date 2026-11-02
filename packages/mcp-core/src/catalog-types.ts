import type { ToolDefinition } from '@praxis/contracts';
import type { JsonSchema } from '@praxis/schema';

export interface CatalogBinding {
  owner: string;
  client: string;
  serverId: string;
  configRevision: number;
  authEpoch: number;
}

export interface CatalogTool extends ToolDefinition {
  rawName: string;
  inputHash: string;
  outputSchema?: JsonSchema;
  headerPaths: Array<{ name: string; path: string[] }>;
  validate(input: unknown): void;
}

export interface Catalog {
  binding: CatalogBinding;
  generation: string;
  protocol: '2026-07-28' | '2025-11-25';
  instructions: string;
  tools: CatalogTool[];
  rejected: Array<{ name: string; code: string }>;
  fetchedAt: number;
  stale: boolean;
}

export type MetadataRpc = (
  method: string,
  params: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<unknown>;
