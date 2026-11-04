import { assert, element, mount, settle } from './ux-visual-browser.tsx';

function key(target: HTMLElement, value: string) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }),
  );
}

export async function dropdownKeyboard() {
  const { Select } = await import(
    new URL('../packages/ui/src/controls/Select.tsx', import.meta.url).href
  );
  const changes: string[] = [];
  const fixture = mount(
    <Select aria-label="模型" value="gpt-6" onChange={(value: string) => changes.push(value)}>
      <option value="gpt-6">GPT-6</option>
      <option value="disabled" disabled>
        不可用
      </option>
      <option value="gpt-sol">GPT-5.6 Sol</option>
    </Select>,
  );
  try {
    const trigger = element<HTMLButtonElement>('.praxis-dropdown-trigger');
    trigger.click();
    await settle();
    const menu = element<HTMLElement>('[popover]'),
      list = element<HTMLElement>('[role="listbox"]');
    assert(menu.matches(':popover-open'), 'Select did not open');
    const selected = element<HTMLElement>('[aria-selected="true"]');
    assert(selected.querySelector('svg'), 'Selected row lacks checkmark');
    assert(
      getComputedStyle(selected).backgroundColor !== getComputedStyle(menu).backgroundColor,
      'Selected row lacks gray background',
    );
    key(list, 'ArrowDown');
    await settle();
    key(list, 'Enter');
    await settle();
    assert(changes.join(',') === 'gpt-sol', 'Keyboard selected a disabled/wrong item');
    assert(
      document.activeElement === trigger && !menu.matches(':popover-open'),
      'Selection did not close/restore focus',
    );
    trigger.click();
    await settle();
    key(list, 'Escape');
    await settle();
    assert(!menu.matches(':popover-open') && changes.length === 1, 'Escape changed selection');
    trigger.click();
    await settle();
    key(list, 'End');
    await settle();
    key(list, 'Home');
    await settle();
    key(list, 'Enter');
    await settle();
    assert(changes.at(-1) === 'gpt-6', 'Home/End navigation failed');
    trigger.click();
    await settle();
    key(list, 'Tab');
    await settle();
    assert(!menu.matches(':popover-open'), 'Tab left the menu open');
  } finally {
    fixture.unmount();
  }
}

export async function dropdownInModal() {
  const { Select } = await import(
    new URL('../packages/ui/src/controls/Select.tsx', import.meta.url).href
  );
  let changes = 0;
  const fixture = mount(
    <dialog style={{ overflow: 'hidden', width: 260, height: 130 }}>
      <fieldset>
        <label>
          协议
          <Select value="one" onChange={() => changes++}>
            {Array.from({ length: 7 }, (_, i) => (
              <option key={i} value={i === 0 ? 'one' : String(i)}>
                选项 {i + 1}
              </option>
            ))}
          </Select>
        </label>
      </fieldset>
    </dialog>,
  );
  try {
    const dialog = element<HTMLDialogElement>('dialog');
    dialog.showModal();
    element<HTMLButtonElement>('.praxis-dropdown-trigger').click();
    await settle();
    const menu = element<HTMLElement>('[popover]'),
      rect = menu.getBoundingClientRect();
    assert(menu.matches(':popover-open'), 'Modal blocked popover');
    assert(rect.right <= innerWidth && rect.bottom <= innerHeight, 'Popover escaped viewport');
    assert(
      menu.contains(document.elementFromPoint(rect.left + 20, rect.bottom - 20)),
      'Modal clipped the dropdown',
    );
    key(element<HTMLElement>('[role="listbox"]'), 'Escape');
    await settle();
    assert(dialog.open && !menu.matches(':popover-open'), 'Escape closed parent dialog');
    element<HTMLButtonElement>('.praxis-dropdown-trigger').click();
    await settle();
    element<HTMLFieldSetElement>('fieldset').disabled = true;
    await settle();
    assert(!menu.matches(':popover-open'), 'Disabled fieldset left an interactive dropdown');
    element<HTMLButtonElement>('[role="option"]').click();
    assert(changes === 0, 'Disabled fieldset allowed changes');
  } finally {
    fixture.unmount();
  }
}

export async function dropdownPlacement() {
  const { Select } = await import(
    new URL('../packages/ui/src/controls/Select.tsx', import.meta.url).href
  );
  const fixture = mount(
    <div style={{ position: 'fixed', bottom: 16, right: 8, width: 160 }}>
      <Select value="one" onChange={() => {}}>
        <option value="one">GPT-6</option>
        <option value="two">GPT-5.6 Sol</option>
      </Select>
    </div>,
  );
  try {
    element<HTMLButtonElement>('.praxis-dropdown-trigger').click();
    await settle();
    const popup = element<HTMLElement>('[popover]'),
      rect = popup.getBoundingClientRect();
    assert(popup.dataset.side === 'top', 'Composer dropdown did not flip above');
    assert(
      rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
      'Dropdown placement overflowed',
    );
  } finally {
    fixture.unmount();
  }
}

export async function dropdownPreview() {
  document.body.style.minHeight = '100dvh';
  const { ModelSelect } = await import(
    new URL('../packages/ui/src/conversation/ModelSelect.tsx', import.meta.url).href
  );
  mount(
    <div
      className="workspace"
      style={{ position: 'fixed', bottom: 80, left: 32, height: 'auto', width: 220 }}
    >
      <ModelSelect
        choices={[
          {
            id: 'deepseek',
            name: 'DeepSeek · deepseek-flash',
            model: 'deepseek-flash',
            enabled: true,
          },
          {
            id: 'deepseek:pro',
            name: 'DeepSeek · deepseek-v4-pro',
            model: 'deepseek-v4-pro',
            enabled: true,
          },
          { id: 'openai', name: 'OpenAI · GPT-6', model: 'GPT-6', enabled: true },
        ]}
        value="deepseek"
        onChange={() => {}}
      />
    </div>,
  );
  element<HTMLButtonElement>('.praxis-dropdown-trigger').click();
  await settle();
}
