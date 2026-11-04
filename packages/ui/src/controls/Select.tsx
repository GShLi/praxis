import { Children, isValidElement, type ReactNode, type OptionHTMLAttributes } from 'react';
import { Dropdown } from './Dropdown.tsx';
import type { DropdownOption } from './dropdown-types.ts';

function optionText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => (typeof child === 'string' || typeof child === 'number' ? String(child) : ''))
    .join('');
}

/** Keeps field-local option declarations; all selection and popup behavior is shared. */
export function Select({
  children,
  'aria-label': label,
  ...props
}: {
  children: ReactNode;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean | undefined;
  'aria-label'?: string;
}) {
  const options: DropdownOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<OptionHTMLAttributes<HTMLOptionElement>>(child) || child.type !== 'option')
      return;
    const label = optionText(child.props.children);
    options.push({
      value: String(child.props.value ?? label),
      label,
      disabled: child.props.disabled,
    });
  });
  return <Dropdown {...props} label={label} options={options} searchable={options.length > 8} />;
}
