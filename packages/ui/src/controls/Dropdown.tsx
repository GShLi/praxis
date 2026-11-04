import { useId } from 'react';
import type { DropdownProps, DropdownOption } from './dropdown-types.ts';
import { useDropdown } from './useDropdown.ts';

export function Dropdown(props: DropdownProps) {
  const generated = useId(),
    id = props.id ?? generated;
  const picker = useDropdown(props);
  const selected = props.options.find((option) => option.value === props.value);
  const title = props.selectedLabel ?? selected?.label ?? props.placeholder ?? '请选择';
  return (
    <div
      className={`praxis-dropdown ${props.className ?? ''}`}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          picker.close(false);
      }}
    >
      <button
        ref={picker.trigger}
        id={id}
        type="button"
        className="praxis-dropdown-trigger"
        aria-label={props.label ? `${props.label}：${title}` : undefined}
        title={[title, selected?.description ?? selected?.group?.label].filter(Boolean).join(' · ')}
        aria-haspopup="listbox"
        aria-controls={`${id}-options`}
        aria-expanded={picker.open}
        disabled={props.disabled}
        onClick={() => (picker.open ? picker.close() : picker.show())}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            picker.show();
          }
        }}
      >
        <OptionText label={title} description={selected?.description} />
        <DropdownMark />
      </button>
      <DropdownMenu props={props} picker={picker} id={id} />
    </div>
  );
}

function OptionText({ label, description }: { label: string; description?: string | undefined }) {
  return (
    <span className="praxis-dropdown-copy">
      <span className="praxis-dropdown-label">{label}</span>
      {description && <span className="praxis-dropdown-description">{description}</span>}
    </span>
  );
}

function DropdownMark({ checked = false }: { checked?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={checked ? 'M5 12l5 5L19 6' : 'm7 10 5 5 5-5'} />
    </svg>
  );
}

type MenuProps = { props: DropdownProps; picker: ReturnType<typeof useDropdown>; id: string };

function DropdownMenu({ props, picker, id }: MenuProps) {
  return (
    <div
      ref={picker.popup}
      popover="auto"
      className="praxis-dropdown-menu"
      data-size={props.menuSize ?? 'regular'}
      data-align={props.align}
      onKeyDown={picker.keyDown}
      onToggle={(event) => picker.setOpen(event.newState === 'open')}
    >
      {props.searchable && <DropdownSearch props={props} picker={picker} id={id} />}
      <DropdownOptions props={props} picker={picker} id={id} />
      {!picker.options.length && (
        <p className="praxis-dropdown-empty" role="status">
          {picker.query ? '没有匹配的选项，请换个关键词。' : (props.emptyText ?? '暂无可用选项')}
        </p>
      )}
    </div>
  );
}

function DropdownSearch({ props, picker, id }: MenuProps) {
  return (
    <input
      className="praxis-dropdown-search"
      type="search"
      role="combobox"
      aria-label={props.searchPlaceholder ?? '搜索选项'}
      placeholder={props.searchPlaceholder ?? '搜索选项'}
      aria-expanded={picker.open}
      aria-controls={`${id}-options`}
      aria-autocomplete="list"
      aria-activedescendant={
        picker.active ? `${id}-option-${picker.options.indexOf(picker.active)}` : undefined
      }
      value={picker.query}
      onChange={(event) => picker.setQuery(event.target.value)}
      autoComplete="off"
    />
  );
}

function DropdownOptions({ props, picker, id }: MenuProps) {
  return (
    <div
      id={`${id}-options`}
      role="listbox"
      tabIndex={-1}
      className="praxis-dropdown-options"
      aria-label={props.label ?? '可用选项'}
      aria-activedescendant={
        picker.active ? `${id}-option-${picker.options.indexOf(picker.active)}` : undefined
      }
    >
      {picker.groups.map((group, index) => (
        <div
          key={index}
          role={group.label ? 'group' : undefined}
          aria-labelledby={group.label ? `${id}-group-${index}` : undefined}
        >
          {group.label && (
            <div id={`${id}-group-${index}`} className="praxis-dropdown-group">
              {group.label}
            </div>
          )}
          {group.options.map((option) => (
            <DropdownItem
              key={option.value}
              props={props}
              picker={picker}
              id={id}
              option={option}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function DropdownItem({ props, picker, id, option }: MenuProps & { option: DropdownOption }) {
  return (
    <button
      id={`${id}-option-${picker.options.indexOf(option)}`}
      type="button"
      role="option"
      tabIndex={-1}
      className="praxis-dropdown-option"
      aria-selected={option.value === props.value}
      aria-disabled={option.disabled || undefined}
      disabled={option.disabled}
      title={option.label}
      data-active={option.value === picker.active?.value}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => picker.choose(option.value)}
    >
      <OptionText label={option.label} description={option.description} />
      {option.value === props.value && <DropdownMark checked />}
    </button>
  );
}
