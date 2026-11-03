import { assert, type Message } from '@praxis/contracts';
import { protocolGroups } from './protocol-groups.ts';
import { estimate } from './tokens.ts';

/** Pin the latest user input and newest complete group, allowing long single-turn histories to shrink. */
export function compactionSource(messages: Message[], retain: number, count = estimate) {
  const groups = protocolGroups(messages);
  const lastUser = groups.findLastIndex((group) => group[0]?.role === 'user');
  let start = groups.length - 1;
  assert(start > 0, 'CONTEXT_TOO_LARGE', '最新输入或不可分工具组过大，无法安全压缩。');
  let retained = count(groups[start]);
  if (lastUser >= 0 && lastUser !== start) retained += count(groups[lastUser]);
  // Optional recent history must fit the soft budget and leave an older prefix to summarize.
  while (start > 0) {
    const next = start - 1;
    if (next - (lastUser >= 0 && lastUser < next ? 1 : 0) < 1) break;
    const size = next === lastUser ? 0 : count(groups[next]);
    if (retained + size > retain) break;
    retained += size;
    start--;
  }
  const prefix = groups.slice(0, start).filter((_group, index) => index !== lastUser);
  assert(prefix.length > 0, 'CONTEXT_TOO_LARGE', '没有可压缩的已完成历史。');
  const preserved = lastUser >= 0 && lastUser < start ? groups[lastUser]! : [];
  return {
    groups: prefix,
    tail: [...preserved, ...groups.slice(start).flat()],
    throughMessageId: groups[start - 1]!.at(-1)!.id,
    preservedMessageIds: preserved.map((m) => m.id),
  };
}
