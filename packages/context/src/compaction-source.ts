import { assert, type Message } from '@praxis/contracts';
import { protocolGroups } from './protocol-groups.ts';
import { estimate } from './tokens.ts';

/** Preserve the latest user input and every following tool exchange as complete groups. */
export function compactionSource(messages: Message[], retain: number, count = estimate) {
  const groups = protocolGroups(messages);
  let start = groups.length;
  let retained = 0;
  const lastUser = groups.findLastIndex((group) => group[0]?.role === 'user');
  while (start > 0 && start > lastUser) {
    retained += count(groups[--start]);
  }
  assert(start > 0, 'CONTEXT_TOO_LARGE', '最新输入或不可分工具组过大，无法安全压缩。');
  // Optional recent history must fit the soft budget and leave an older prefix to summarize.
  while (start > 1) {
    const size = count(groups[start - 1]);
    if (retained + size > retain) break;
    retained += size;
    start--;
  }
  return { groups: groups.slice(0, start), tail: groups.slice(start).flat() };
}
