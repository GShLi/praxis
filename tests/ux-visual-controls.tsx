import { assert, element, mount } from './ux-visual-browser.tsx';

export function outlineControls() {
  for (const theme of ['light', 'dark']) {
    document.documentElement.dataset.theme = theme;
    for (const scope of ['settings-page', 'settings-dialog', 'login-page', 'workspace']) {
      const fixture = mount(
        <section className={scope}>
          <input aria-label="名称" defaultValue="Praxis" />
          <select aria-label="选项">
            <option>默认</option>
          </select>
          <textarea aria-label="说明" />
          <button className="secondary-button">取消</button>
          <button className="primary-button compact">保存</button>
          <button className="danger-button">删除</button>
          <input type="checkbox" aria-label="启用" />
        </section>,
      );
      try {
        for (const selector of [
          'input:not([type])',
          'select',
          'textarea',
          '.secondary-button',
          '.primary-button',
          '.danger-button',
        ]) {
          checkControl(selector, `${theme}/${scope}/${selector}`);
        }
        checkFieldStates();
        const checkbox = element<HTMLInputElement>('input[type="checkbox"]');
        assert(checkbox.getBoundingClientRect().width <= 24, 'Checkbox expanded to field width');
      } finally {
        fixture.unmount();
      }
    }
  }
}

function checkControl(selector: string, context: string) {
  const control = element<HTMLInputElement>(selector);
  const normal = getComputedStyle(control);
  assert(
    normal.borderTopStyle === 'solid' && parseFloat(normal.borderTopWidth) >= 1,
    `${context}: missing outline border`,
  );
  assert(control.getBoundingClientRect().height >= 40, `${context}: small target`);
  assert(normal.fontSize === '14px', `${context}: inconsistent font size`);
  assert(normal.borderRadius === '8px', `${context}: inconsistent corner radius`);
  control.focus();
  assert(parseFloat(getComputedStyle(control).outlineWidth) >= 2, `${context}: invisible focus`);
  control.disabled = true;
  assert(
    getComputedStyle(control).cursor === 'not-allowed',
    `${context}: missing disabled feedback`,
  );
}

function checkFieldStates() {
  const input = element<HTMLInputElement>('input:not([type])');
  input.disabled = false;
  input.readOnly = true;
  const reference = document.createElement('span');
  document.body.append(reference);
  try {
    reference.style.color = 'var(--raised)';
    assert(
      getComputedStyle(input).backgroundColor === getComputedStyle(reference).color,
      'Readonly field has no distinct background',
    );
    input.readOnly = false;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    reference.style.color = 'var(--error)';
    const error = getComputedStyle(reference).color;
    assert(getComputedStyle(input).borderTopColor === error, 'Error field has no error border');
    assert(getComputedStyle(input).outlineColor === error, 'Error field has no error focus ring');
  } finally {
    reference.remove();
  }
}
