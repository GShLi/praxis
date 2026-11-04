import type { Event, ToolResult } from '@praxis/contracts';
import type { ApprovalRequest } from '@praxis/permissions';
import type { Snapshot, ViewMessage } from '@praxis/ui/client';

// Independent observable test contracts for dynamically loaded UI internals.
export interface DiffLine {
  kind: 'context' | 'add' | 'remove';
  beforeLine: number | null;
  afterLine: number | null;
  raw: string;
}
export interface DiffResult {
  lines: DiffLine[];
  additions: number;
  deletions: number;
  complete: boolean;
  coarse: boolean;
}
export interface DiffModule {
  lineDiff(before: string | null, after: string): DiffResult;
  diffLimits: {
    characters: number;
    lines: number;
    cells: number;
    displayRows: number;
    lineCharacters: number;
  };
}
export interface DiffPresentation {
  diffRows(diff: DiffResult): {
    rows: Array<DiffLine | { kind: 'gap'; count: number }>;
    omittedRows: number;
  };
  diffLineText(raw: string): { text: string; truncated: boolean; ending: string };
}
export interface FileChange {
  path: string;
  before: string | null;
  after: string;
}
export interface FileModule {
  parseFileChangeArtifact(artifact: { kind: string; content: string }): FileChange;
}
export interface ToolPresentation {
  toolAction(toolId: string, data?: unknown): string;
  toolOutcome(result: ToolResult): string;
  toolVisualStatus(result: ToolResult): string;
  toolSummary(result: ToolResult): string;
  toolStatusText: Record<ToolResult['status'], string>;
  parseToolResult(content: string): ToolResult | null;
}
export interface ApprovalPresentation {
  approvalPresentation(approval: ApprovalRequest): {
    action: string;
    target: string;
    effect: string;
  };
}
export interface Timing {
  startedAt: number | null;
  finishedAt: number | null;
  active: boolean;
}
export interface TaskPresentation {
  taskStatus(status: string): string;
  currentTaskAction(snapshot: Snapshot, events: readonly Event[], partial?: string): string;
  taskTiming(snapshot: Snapshot, events: readonly Event[]): Timing;
  elapsedText(timing: Timing, now: number): string;
  taskResults(snapshot: Snapshot): {
    durationMs: number;
    files: Array<{ artifactId: string; path: string }>;
    summary: ViewMessage | undefined;
  };
}
