import { assert, type Message } from '@praxis/contracts';
import { hash, type SessionStore } from '@praxis/storage-local';
import { protocolGroups } from './protocol-groups.ts';

export function readContextHistory(store: SessionStore, id: string) {
  const view = store.context(id);
  const all = store.messages(id);
  const through = view.throughMessageId ? all.findIndex((m) => m.id === view.throughMessageId) : -1;
  assert(!view.throughMessageId || through >= 0, 'INVALID_CONTEXT', '上下文来源消息不存在。');
  const preserved = (view.preservedMessageIds ?? []).map((id) => {
    const index = all.findIndex((m) => m.id === id);
    const message = all[index];
    assert(
      message?.role === 'user' && index <= through,
      'INVALID_CONTEXT',
      '保留的用户输入不存在。',
    );
    return message;
  });
  const projections = new Map((view.toolOutputs ?? []).map((output) => [output.messageId, output]));
  const remaining: Message[] = all.slice(through + 1).map((message) => {
    const projection = projections.get(message.id);
    if (!projection) return message;
    assert(
      message.role === 'tool' && hash(message.content) === projection.sourceHash,
      'INVALID_CONTEXT',
      '工具正文投影与原始消息不一致。',
    );
    projections.delete(message.id);
    return { ...message, content: projection.content };
  });
  assert(projections.size === 0, 'INVALID_CONTEXT', '工具正文投影没有对应消息。');
  const history = [...(view.summary ? [view.summary] : []), ...preserved, ...remaining];
  protocolGroups(history);
  return { view, history };
}
