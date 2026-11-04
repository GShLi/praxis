import type { DropdownOption } from './dropdown-types.ts';

/** Keep the rendered group order and keyboard navigation order identical. */
export function dropdownGroups(options: readonly DropdownOption[], query: string) {
  const groups = new Map<string | undefined, { label: string; options: DropdownOption[] }>();
  const term = query.trim().toLocaleLowerCase();
  for (const option of options) {
    if (
      !`${option.label} ${option.description ?? ''} ${option.group?.label ?? ''}`
        .toLocaleLowerCase()
        .includes(term)
    )
      continue;
    const id = option.group?.id;
    let group = groups.get(id);
    if (!group) {
      group = { label: option.group?.label ?? '', options: [] };
      groups.set(id, group);
    }
    group.options.push(option);
  }
  return [...groups.values()];
}
