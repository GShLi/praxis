import { providerFixture } from './fixtures/provider-fixture.ts';
import { assert, element, mount, settle } from './ux-visual-browser.tsx';

export async function groupedModels() {
  const { ModelSelect } = await import(
    new URL('../packages/ui/src/conversation/ModelSelect.tsx', import.meta.url).href
  );
  const choices = [
    { id: 'a', name: 'Cloud A · chat', model: 'chat', enabled: true },
    { id: 'b', name: 'Cloud B · chat', model: 'chat', enabled: true },
    { id: 'a:code', name: 'Cloud A · code', model: 'code', enabled: true },
  ];
  const changes: string[] = [];
  const fixture = mount(
    <ModelSelect choices={choices} value="a" onChange={(value: string) => changes.push(value)} />,
  );
  try {
    const trigger = element<HTMLButtonElement>('.praxis-dropdown-trigger');
    assert(trigger.textContent === 'Cloud A · chat', 'Same-name models are ambiguous');
    trigger.click();
    await settle();
    const headings = [...document.querySelectorAll('.praxis-dropdown-group')];
    assert(
      headings.map((node) => node.textContent).join(',') === 'Cloud A,Cloud B',
      'Group repeated',
    );
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    assert(
      options.map((node) => node.textContent).join(',') === 'chat,code,chat',
      'Wrong group order',
    );
    assert(
      !document.querySelector('.praxis-dropdown-description'),
      'Model options have extra rows',
    );
    assert(
      options.every((node) => node.getBoundingClientRect().height < 50),
      'Rows too tall',
    );
    const list = element<HTMLElement>('[role="listbox"]');
    for (const key of ['ArrowDown', 'Enter']) {
      list.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      await settle();
    }
    assert(changes.at(-1) === 'a:code', 'Keyboard order differs from grouped display');
  } finally {
    fixture.unmount();
  }
}

export async function defaultModelFallback() {
  const { General } = await import(
    new URL('../packages/ui/src/settings/General.tsx', import.meta.url).href
  );
  const providers = await providerFixture().providers();
  const previous = localStorage.getItem('praxis-default-provider');
  try {
    for (const preference of ['', 'removed-provider']) {
      localStorage.setItem('praxis-default-provider', preference);
      const fixture = mount(<General providers={providers} />);
      try {
        const trigger = element<HTMLButtonElement>('.model-select .praxis-dropdown-trigger');
        assert(trigger.textContent?.includes('fixture-chat'), 'Effective default model not shown');
        trigger.click();
        await settle();
        assert(
          !fixture.container.textContent?.includes('首个可用模型'),
          'Synthetic default remains',
        );
        const selected = element<HTMLElement>('.model-select [aria-selected="true"]');
        assert(selected.textContent === 'fixture-chat', 'Effective default is not checked');
        const other = [
          ...document.querySelectorAll<HTMLButtonElement>('.model-select [role="option"]'),
        ].find((node) => node.textContent === 'fixture-reasoner');
        assert(other, 'Reasoning model missing');
        other.click();
        await settle();
        assert(
          localStorage.getItem('praxis-default-provider') === 'fixture:reasoning',
          'Selection not saved',
        );
      } finally {
        fixture.unmount();
      }
    }
  } finally {
    if (previous === null) localStorage.removeItem('praxis-default-provider');
    else localStorage.setItem('praxis-default-provider', previous);
  }
}
