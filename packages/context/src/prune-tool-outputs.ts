import { hash, type SessionStore } from '@praxis/storage-local';
import { readContextHistory } from './context-history.ts';
import { protocolGroups } from './protocol-groups.ts';
import { toolBody } from './tool-body.ts';

/** Artifact creation and view publication share the writer transaction; no orphan on cancellation/CAS failure. */
export function pruneToolOutputs(store: SessionStore, id: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const { view, history } = readContextHistory(store, id);
  const existing = new Set(view.toolOutputs?.map((output) => output.messageId));
  const candidates = protocolGroups(history)
    .slice(0, -2)
    .flatMap((group) =>
      group.flatMap((message) => {
        if (message.role !== 'tool' || existing.has(message.id)) return [];
        const project = toolBody(message.content);
        return project ? [{ message, project }] : [];
      }),
    )
    .slice(0, Math.min(32, 256 - existing.size));
  if (!candidates.length) return false;
  return store.transaction(() => {
    const outputs = [...(view.toolOutputs ?? [])];
    for (const { message, project } of candidates) {
      signal.throwIfAborted();
      const sourceHash = hash(message.content);
      const preview = project('00000000-0000-4000-8000-000000000000', sourceHash);
      if (
        Buffer.byteLength(preview) >= Buffer.byteLength(message.content) ||
        preview.length > 16384
      )
        continue;
      const artifactId = store.artifact(id, 'context-tool-output', message.content);
      outputs.push({
        messageId: message.id,
        sourceHash,
        artifactId,
        content: project(artifactId, sourceHash),
      });
    }
    if (outputs.length === existing.size) return false;
    signal.throwIfAborted();
    store.publishContext(id, view.version, { ...view, toolOutputs: outputs }, 'tool-output');
    return true;
  });
}
