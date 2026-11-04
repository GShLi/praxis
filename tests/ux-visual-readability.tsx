import { assert, element, mount } from './ux-visual-browser.tsx';

function luminance(color: string) {
  const channels = color
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number);
  assert(channels?.length === 3, `Unsupported computed color ${color}`);
  return channels.reduce((sum, value, i) => {
    const c = value / 255;
    return (
      sum + (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]!
    );
  }, 0);
}

export function secondaryContrast() {
  for (const theme of ['light', 'dark']) {
    document.documentElement.dataset.theme = theme;
    for (const surface of ['bg', 'sidebar', 'raised', 'hover', 'code']) {
      const backdrop = document.createElement('div');
      backdrop.style.background = `var(--${surface})`;
      const label = document.createElement('small');
      label.textContent = '辅助说明';
      backdrop.append(label);
      document.body.append(backdrop);
      try {
        const foreground = luminance(getComputedStyle(label).color);
        const background = luminance(getComputedStyle(backdrop).backgroundColor);
        const ratio =
          (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
        assert(ratio >= 4.5, `${theme}/${surface} secondary contrast ${ratio.toFixed(2)} < 4.5`);
        assert(
          parseFloat(getComputedStyle(label).fontSize) >= 13,
          'Help text is smaller than 13px',
        );
      } finally {
        backdrop.remove();
      }
    }
  }
}

export async function focusAndLayout() {
  const { Login } = await import(
    new URL('../packages/ui/src/auth/Login.tsx', import.meta.url).href
  );
  const fixture = mount(<Login desktop error="" onSubmit={async () => false} />);
  try {
    for (const selector of ['input', 'a', 'button']) {
      const control = element<HTMLElement>(selector);
      control.focus();
      assert(
        parseFloat(getComputedStyle(control).outlineWidth) >= 2,
        `${selector} lacks visible focus: active=${document.activeElement?.tagName}, focused=${control.matches(':focus')}, visible=${control.matches(':focus-visible')}, outline=${getComputedStyle(control).outline}`,
      );
    }
    for (const selector of ['.login-form > p', '.login-key-help', 'small', 'footer']) {
      const help = element<HTMLElement>(selector);
      assert(parseFloat(getComputedStyle(help).fontSize) >= 13, `${selector} is too small`);
    }
    assert(document.documentElement.scrollWidth <= innerWidth, 'Login overflows the viewport');
  } finally {
    fixture.unmount();
  }
}

export function reducedMotion() {
  assert(
    matchMedia('(prefers-reduced-motion: reduce)').matches,
    'Reduced-motion emulation is missing',
  );
  const fixture = mount(<span className="stream-cursor" style={{ transition: 'opacity 1s' }} />);
  try {
    const cursor = element<HTMLElement>('.stream-cursor');
    assert(getComputedStyle(cursor).animationName === 'none', 'Reduced motion still pulses');
    assert(
      getComputedStyle(cursor).transitionDuration === '0s',
      'Reduced motion still transitions',
    );
  } finally {
    fixture.unmount();
  }
}
