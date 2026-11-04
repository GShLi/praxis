import type { ViewSession } from '../client-types.ts';

export const activeStatuses = new Set([
  'running',
  'waiting_input',
  'waiting_approval',
  'cancelling',
]);
export function sessionGroups(sessions: ViewSession[], now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const week = new Date(today);
  week.setDate(today.getDate() - 7);
  const groups = new Map<string, ViewSession[]>();
  for (const session of [...sessions].sort(
    (a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0),
  )) {
    const time = Date.parse(session.createdAt ?? '');
    const label = !Number.isFinite(time)
      ? '其他会话'
      : time >= today.getTime()
        ? '今天'
        : time >= yesterday.getTime()
          ? '昨天'
          : time >= week.getTime()
            ? '近 7 天'
            : '更早';
    const rows = groups.get(label) ?? [];
    rows.push(session);
    groups.set(label, rows);
  }
  return [...groups].map(([label, rows]) => ({ label, rows }));
}
