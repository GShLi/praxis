import { assert } from '@praxis/contracts';
import type { SessionStore } from '@praxis/storage-local';
import { z } from 'zod';
import { ProcessOutput, outputChunksSchema } from './output.ts';
import type { OutputChunk } from './output-page.ts';
import type { CommandPlan, ExecutionRecord } from './types.ts';

const recordSchema = z.object({
  executionId: z.string().min(1).max(128),
  turnId: z.string().min(1).max(128),
  description: z.string().max(4096),
  processState: z.enum([
    'running',
    'cancelling',
    'succeeded',
    'failed',
    'cancelled',
    'timed_out',
    'unknown',
  ]),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
});

/** Immutable head chunks survive crashes; the final tail is committed with the terminal event. */
export class ExecutionJournal {
  constructor(
    private store: SessionStore,
    private sessionId: string,
  ) {}
  intent(record: ExecutionRecord, plan: CommandPlan, callId: string) {
    this.store.append(this.sessionId, 'execution/intent', {
      scope: record.executionId,
      record,
      plan,
      callId,
    });
  }
  head(executionId: string, chunks: OutputChunk[]) {
    if (!chunks.length) return;
    this.store.transaction(() => {
      const artifactId = this.store.artifact(
        this.sessionId,
        'execution-head',
        JSON.stringify(chunks),
      );
      this.store.append(this.sessionId, 'execution/output', { scope: executionId, artifactId });
    });
  }
  started(executionId: string) {
    this.store.append(this.sessionId, 'execution/started', { scope: executionId });
  }
  finish(record: ExecutionRecord, output: ProcessOutput) {
    this.store.transaction(() => {
      const artifactId = this.store.artifact(
        this.sessionId,
        'execution-tail',
        JSON.stringify(output.tailSnapshot()),
      );
      this.store.append(this.sessionId, 'execution/finished', {
        scope: record.executionId,
        record,
        artifactId,
      });
    });
  }
  record(executionId: string): ExecutionRecord {
    const final = this.store.latestEvent(this.sessionId, 'execution/finished', executionId);
    const event = final ?? this.store.latestEvent(this.sessionId, 'execution/intent', executionId);
    assert(event, 'EXECUTION_NOT_FOUND', '此会话没有该命令。');
    const record = recordSchema.parse(event.payload.record);
    return final ? record : { ...record, processState: 'unknown' };
  }
  list(limit: number) {
    return this.store
      .matchingEvents(this.sessionId, 'execution/intent', limit)
      .map((event) => this.record(recordSchema.parse(event.payload.record).executionId));
  }
  output(executionId: string) {
    this.record(executionId);
    const chunks = this.store
      .matchingEvents(this.sessionId, 'execution/output', 2048, executionId)
      .reverse()
      .flatMap((event) =>
        outputChunksSchema.parse(this.artifact(event.payload.artifactId, 'execution-head')),
      );
    const final = this.store.latestEvent(this.sessionId, 'execution/finished', executionId);
    if (final) {
      const tail = this.artifact(final.payload.artifactId, 'execution-tail');
      assert(
        tail && typeof tail === 'object' && 'chunks' in tail && Array.isArray(tail.chunks),
        'OUTPUT_SNAPSHOT_INVALID',
        '命令输出快照无效。',
      );
      return ProcessOutput.restore(executionId, { ...tail, chunks: [...chunks, ...tail.chunks] });
    }
    const last = chunks.at(-1);
    return ProcessOutput.restore(executionId, {
      version: 1,
      chunks,
      totalBytes: last ? last.start + Buffer.byteLength(last.text) : 0,
      outputTruncated: true,
    });
  }
  private artifact(id: unknown, kind: string): unknown {
    assert(typeof id === 'string', 'OUTPUT_SNAPSHOT_INVALID', '命令产物标识无效。');
    const result = this.store.readArtifact(this.sessionId, id);
    assert(result.kind === kind, 'OUTPUT_SNAPSHOT_INVALID', '命令产物类型无效。');
    return JSON.parse(result.content);
  }
}
