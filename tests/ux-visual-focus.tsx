import { assert, element, mount, settle } from './ux-visual-browser.tsx';

export function compoundFocus() {
  for (const name of ['settings-search', 'provider-list-search', 'session-search-input']) {
    const fixture = mount(
      <div className="settings-page session-search-dialog">
        <div className={name}>
          <span aria-hidden="true">⌕</span>
          <input placeholder="搜索" />
        </div>
      </div>,
    );
    try {
      const input = element<HTMLInputElement>('input');
      input.focus();
      const outer = element<HTMLElement>(`.${name}`),
        innerStyle = getComputedStyle(input),
        outerStyle = getComputedStyle(outer);
      assert(
        innerStyle.borderTopWidth === '0px' && innerStyle.outlineStyle === 'none',
        `${name}: nested focus/border`,
      );
      assert(parseFloat(outerStyle.outlineOffset) < 0, `${name}: detached focus ring`);
      assert(parseFloat(outerStyle.outlineWidth) >= 2, `${name}: missing focus indicator`);
      if (name !== 'session-search-input')
        assert(outer.getBoundingClientRect().height <= 44, `${name}: search height inflated`);
    } finally {
      fixture.unmount();
    }
  }
}

export async function compactComposer() {
  const { ModelSelect } = await import(
    new URL('../packages/ui/src/conversation/ModelSelect.tsx', import.meta.url).href
  );
  const fixture = mount(
    <div className="workspace" style={{ height: 600 }}>
      <div style={{ flex: 1 }} />
      <div className="conversation-footer">
        <button className="latest">回到最新</button>
        <div className="composer-region">
          <div className="composer">
            <textarea placeholder="询问知行 Praxis" />
            <div className="composer-bottom">
              <ModelSelect
                choices={[
                  {
                    id: 'deepseek',
                    name: 'DeepSeek · deepseek-flash',
                    model: 'deepseek-flash',
                    enabled: true,
                  },
                ]}
                value="deepseek"
                onChange={() => {}}
              />
              <div className="composer-actions">
                <button className="send-button">↑</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
  );
  try {
    element<HTMLTextAreaElement>('textarea').focus();
    const composer = element<HTMLElement>('.composer');
    assert(getComputedStyle(composer).outlineOffset === '-2px', 'Composer has detached outline');
    assert(
      element<HTMLElement>('.latest').getBoundingClientRect().bottom <
        composer.getBoundingClientRect().top,
      'Latest button overlaps composer',
    );
    const trigger = element<HTMLButtonElement>('.praxis-dropdown-trigger');
    assert(trigger.getBoundingClientRect().height <= 42, 'Model trigger has an extra row');
    trigger.click();
    await settle();
    assert(
      !document.querySelector('.praxis-dropdown-search'),
      'Short model list has unnecessary search',
    );
    assert(
      getComputedStyle(element<HTMLElement>('[role="listbox"]')).outlineStyle === 'none',
      'Listbox has a second frame',
    );
    assert(
      !document.querySelector('[aria-selected="true"]')?.getAttribute('style'),
      'Selected row has ad-hoc style',
    );
  } finally {
    fixture.unmount();
  }
}
