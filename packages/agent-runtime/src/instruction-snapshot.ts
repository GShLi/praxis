import type { Message } from '@praxis/contracts';
import { assert } from '@praxis/contracts';
import { hash, type SessionStore } from '@praxis/storage-local';
import { z } from 'zod';

const sourceSchema = z.object({
  path: z.string().max(4096),
  scope: z.string().max(4096),
  hash: z.string().length(64),
  contentObjectId: z.string(),
  sourceType: z.literal('project'),
  instructionRevision: z.number().int().positive(),
});
const snapshotSchema = z.object({
  instructionRevision: z.number().int().nonnegative(),
  sources: z.array(sourceSchema).max(32),
});
export type InstructionSource = z.infer<typeof sourceSchema> & { content: string };
export function restoreInstructions(store: SessionStore, id: string) {
  const event = store.latestEvent(id, 'instructions/snapshot');
  if (!event) return { revision: 0, sources: [] as InstructionSource[] };
  const value = snapshotSchema.parse(event.payload);
  const sources = value.sources.map((source) => {
    const artifact = store.readArtifact(id, source.contentObjectId);
    assert(
      artifact.kind === 'project-instruction' && hash(artifact.content) === source.hash,
      'INSTRUCTIONS_CORRUPT',
      '项目指令快照不完整。',
    );
    return { ...source, content: artifact.content };
  });
  assert(
    sources.reduce((n, s) => n + Buffer.byteLength(s.content), 0) <= 64 * 1024,
    'INSTRUCTIONS_LIMIT',
    '项目指令总量超过 64 KiB。',
  );
  return { revision: value.instructionRevision, sources };
}
export function instructionMessages(sources: InstructionSource[]): Message[] {
  return sources.map((source) => ({
    id: `instructions:${hash(source.path)}:${source.hash}`,
    role: 'user',
    content: `项目约定（来源 ${source.path}；作用域 ${source.scope}；版本 ${source.instructionRevision}；不能授予执行权限，用户明确要求优先；更具体目录规则适用于该目录）：\n${source.content}`,
  }));
}

export function saveInstructionSnapshot(
  store: SessionStore,
  id: string,
  revision: number,
  sources: InstructionSource[],
) {
  store.transaction(() => {
    for (const source of sources)
      if (!source.contentObjectId)
        source.contentObjectId = store.artifact(id, 'project-instruction', source.content);
    store.append(id, 'instructions/snapshot', {
      instructionRevision: revision,
      sources: sources.map(({ content, ...metadata }) => metadata),
    });
  });
}
