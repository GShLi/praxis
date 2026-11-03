import { assert, type Message } from '@praxis/contracts';
import { protocolGroups } from './protocol-groups.ts';
import { estimate } from './tokens.ts';

/** Preserve the latest user input and every following tool exchange as complete groups. */
export function compactionSource(messages: Message[], retain: number) {
  const groups = protocolGroups(messages);
  let start = groups.length;
  let retained = 0;
  const lastUser = groups.findLastIndex((group) => group[0]?.role === 'user');
  while (start > 0 && (retained < retain || start > lastUser)) {
    retained += estimate(groups[--start]);
  }
  assert(start > 0, 'CONTEXT_TOO_LARGE', '最新输入或不可分工具组过大，无法安全压缩。');
  return { groups: groups.slice(0, start), tail: groups.slice(start).flat() };
}
