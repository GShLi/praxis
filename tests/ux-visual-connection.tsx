import { assert, element, mount } from './ux-visual-browser.tsx';

export async function connectionStates() {
  const { ConnectionState } = await import(
    new URL('../packages/ui/src/auth/ConnectionState.tsx', import.meta.url).href
  );
  for (const theme of ['light', 'dark']) {
    document.documentElement.dataset.theme = theme;
    let attempts = 0;
    const fixture = mount(
      <ConnectionState busy={false} error="请求参数不符合协议。" retry={() => attempts++} />,
    );
    try {
      const card = element<HTMLElement>('.connection-card');
      assert(card.getBoundingClientRect().width <= 420, 'Error content is too wide');
      assert(document.documentElement.scrollWidth <= innerWidth, 'Error page overflows viewport');
      assert(
        !element<HTMLDetailsElement>('details').open,
        'Technical details should start collapsed',
      );
      const button = element<HTMLButtonElement>('button');
      button.focus();
      assert(parseFloat(getComputedStyle(button).outlineWidth) >= 2, 'Retry focus is invisible');
      button.click();
      assert(attempts === 1, 'Retry did not propagate');
      fixture.render(<ConnectionState busy error="" retry={() => attempts++} />);
      const busy = element<HTMLButtonElement>('button');
      assert(busy.disabled, 'Connection pending permits duplicate retries');
      busy.click();
      assert(attempts === 1, 'Disabled retry executed');
      assert(!fixture.container.querySelector('details'), 'Loading retained obsolete error');
    } finally {
      fixture.unmount();
    }
  }
}
