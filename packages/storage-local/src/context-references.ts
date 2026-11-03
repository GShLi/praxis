import { assert } from '@praxis/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { hash } from './identity.ts';
import { messageSchema, type ContextView } from './context-schema.ts';

/** Validate only referenced rows. Never trust an imported projection to name another session's output. */
export function validateContextReferences(db: DatabaseSync, sessionId: string, view: ContextView) {
  const message = (id: string) => {
    const row = db
      .prepare('SELECT ordinal,document FROM messages WHERE session_id=? AND id=?')
      .get(sessionId, id);
    assert(row, 'INVALID_CONTEXT', '上下文引用的原始消息不存在。');
    return {
      ordinal: Number(row.ordinal),
      message: messageSchema.parse(JSON.parse(String(row.document))),
    };
  };
  const through = view.throughMessageId ? message(view.throughMessageId).ordinal : -1;
  for (const id of view.preservedMessageIds ?? []) {
    const source = message(id);
    assert(
      source.ordinal <= through && source.message.role === 'user',
      'INVALID_CONTEXT',
      '保留的用户输入引用无效。',
    );
  }
  const ids = new Set<string>();
  for (const output of view.toolOutputs ?? []) {
    const source = message(output.messageId);
    assert(
      !ids.has(output.messageId) &&
        source.ordinal > through &&
        source.message.role === 'tool' &&
        hash(source.message.content) === output.sourceHash,
      'INVALID_CONTEXT',
      '工具正文投影来源无效。',
    );
    ids.add(output.messageId);
    const artifact = db
      .prepare('SELECT kind,content FROM artifacts WHERE id=? AND session_id=?')
      .get(output.artifactId, sessionId);
    assert(
      artifact?.kind === 'context-tool-output' && artifact.content === source.message.content,
      'INVALID_CONTEXT',
      '工具正文投影产物无效。',
    );
  }
}
