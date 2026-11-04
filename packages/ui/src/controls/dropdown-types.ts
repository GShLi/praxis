export interface DropdownOption {
  value: string;
  label: string;
  description?: string | undefined;
  group?: { id: string; label: string };
  disabled?: boolean | undefined;
}

export interface DropdownProps {
  options: readonly DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean | undefined;
  label?: string | undefined;
  id?: string | undefined;
  className?: string | undefined;
  searchable?: boolean | undefined;
  searchPlaceholder?: string | undefined;
  placeholder?: string | undefined;
  selectedLabel?: string | undefined;
  emptyText?: string | undefined;
  menuSize?: 'compact' | 'regular' | undefined;
  align?: 'start' | 'end' | undefined;
}
