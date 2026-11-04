import { assert, element, inputValue, mount, settle } from './ux-visual-browser.tsx';

const longModel = 'organization/very-long-model-name-with-distinct-reasoning-version-2026-11-04';
const choices = [
  { id: 'one', name: `Provider One · ${longModel}`, model: longModel, enabled: true },
  { id: 'two', name: 'Provider Two · quick-model', model: 'quick-model', enabled: true },
  { id: 'disabled', name: 'Provider Three · hidden-model', model: 'hidden-model', enabled: false },
  ...Array.from({ length: 5 }, (_, index) => ({
    id: `extra-${index}`,
    name: `Extra ${index}`,
    model: `extra-${index}`,
    enabled: true,
  })),
];

function key(input: HTMLInputElement, value: string, composing = false) {
  input.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: value,
      bubbles: true,
      cancelable: true,
      isComposing: composing,
    }),
  );
}

export async function modelSearchAndSelection() {
  const { ModelSelect } = await import(
    new URL('../packages/ui/src/conversation/ModelSelect.tsx', import.meta.url).href
  );
  const changes: string[] = [];
  const fixture = mount(
    <ModelSelect choices={choices} value="one" onChange={(id: string) => changes.push(id)} />,
  );
  try {
    const trigger = element<HTMLButtonElement>('.praxis-dropdown-trigger');
    trigger.click();
    await settle();
    const search = element<HTMLInputElement>('input[role="combobox"]');
    assert(
      document.activeElement === search,
      `Picker did not focus search: ${document.activeElement?.tagName}/${document.activeElement?.className}`,
    );
    assert(
      document.querySelectorAll('[role="option"]').length === 7,
      'Disabled model remained selectable',
    );
    inputValue(search, 'PROVIDER TWO');
    await settle();
    assert(
      document.querySelectorAll('[role="option"]').length === 1,
      'Provider search did not filter',
    );
    key(search, 'Enter', true);
    assert(changes.length === 0, 'IME composition selected a model');
    key(search, 'Enter');
    await settle();
    assert(changes.at(-1) === 'two', 'Search selected the wrong model ID');
    assert(
      !element<HTMLElement>('[popover]').matches(':popover-open'),
      'Picker did not close after selection',
    );
    assert(document.activeElement === trigger, 'Picker did not restore trigger focus');
    trigger.click();
    await settle();
    inputValue(search, 'no-match');
    await settle();
    key(search, 'Enter');
    assert(changes.join(',') === 'two', 'Empty search selected a hidden model');
    assert(document.querySelector('[role="status"]'), 'Empty search has no feedback');
  } finally {
    fixture.unmount();
  }
}

export async function modelKeyboardAndDefault() {
  const { ModelSelect } = await import(
    new URL('../packages/ui/src/conversation/ModelSelect.tsx', import.meta.url).href
  );
  const changes: string[] = [];
  const props = {
    choices,
    value: 'one',
    onChange: (id: string) => changes.push(id),
  };
  const fixture = mount(<ModelSelect {...props} />);
  try {
    const trigger = element<HTMLButtonElement>('.praxis-dropdown-trigger');
    trigger.click();
    await settle();
    const search = element<HTMLInputElement>('input[role="combobox"]');
    key(search, 'ArrowDown');
    await settle();
    key(search, 'Enter');
    await settle();
    assert(changes.at(-1) === 'two', 'Arrow navigation selected the wrong model');
    trigger.click();
    await settle();
    inputValue(search, '首个');
    await settle();
    key(search, 'Enter');
    await settle();
    assert(changes.join(',') === 'two', 'Synthetic default option remained selectable');
    assert(document.querySelectorAll('[role="option"]').length === 0, 'Synthetic option remains');
    fixture.render(<ModelSelect {...props} disabled />);
    await settle();
    assert(
      !element<HTMLElement>('[popover]').matches(':popover-open'),
      'Disabled picker stayed open',
    );
    trigger.click();
    assert(
      !element<HTMLElement>('[popover]').matches(':popover-open'),
      'Disabled picker could open',
    );
  } finally {
    fixture.unmount();
  }
}

export async function modelNameWrapping() {
  const { ModelSelect } = await import(
    new URL('../packages/ui/src/conversation/ModelSelect.tsx', import.meta.url).href
  );
  const fixture = mount(
    <div style={{ width: 180 }}>
      <ModelSelect choices={choices} value="one" onChange={() => {}} />
    </div>,
  );
  try {
    const text = element<HTMLElement>('.praxis-dropdown-trigger .praxis-dropdown-label');
    assert(text.textContent === longModel, 'Selected model name was shortened');
    assert(text.scrollWidth <= text.clientWidth, 'Selected model name overflows its container');
    assert(
      text.clientHeight > parseFloat(getComputedStyle(text).lineHeight),
      'Long model name did not wrap',
    );
    assert(!document.querySelector('.praxis-dropdown-description'), 'Model has a second line');
    assert(
      element<HTMLElement>('.praxis-dropdown-trigger').title.includes('Provider One'),
      'Provider missing from tooltip',
    );
  } finally {
    fixture.unmount();
  }
}
