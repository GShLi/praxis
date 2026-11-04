import { assert, deferred, element, inputValue, mount, settle } from './ux-visual-browser.tsx';

async function loginOutcome(desktop: boolean, result: boolean | void | 'reject') {
  const { Login } = await import(
    new URL('../packages/ui/src/auth/Login.tsx', import.meta.url).href
  );
  const pending = deferred<boolean | void>();
  let attempts = 0;
  const fixture = mount(
    <Login
      desktop={desktop}
      error=""
      onSubmit={() => {
        attempts++;
        return pending.promise;
      }}
    />,
  );
  try {
    const fields = [...fixture.container.querySelectorAll('input')];
    const secret = element<HTMLInputElement>('input[type="password"]');
    const identity = fields[0];
    assert(identity, 'Identity field missing');
    const identityValue = desktop ? 'https://praxis.example' : 'fixture-user';
    inputValue(identity, identityValue);
    inputValue(secret, 'fixture-only-secret');
    await settle();
    const form = element<HTMLFormElement>('form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    assert(attempts === 1, 'Busy login was submitted twice');
    assert(
      fields.every((field) => field.disabled),
      'Login fields remained editable while busy',
    );
    assert(element<HTMLButtonElement>('button[type="submit"]').disabled, 'Submit remained enabled');
    if (result === 'reject') pending.reject(new Error('fixture-only-secret'));
    else pending.resolve(result);
    await settle();
    assert(
      secret.value === (result === true ? '' : 'fixture-only-secret'),
      'Incorrect credential clearing',
    );
    assert(identity.value === identityValue, 'Login lost the typed identity');
    assert(
      fields.every((field) => !field.disabled),
      'Login fields stayed disabled after the attempt',
    );
    if (result === 'reject') {
      const alert = element<HTMLElement>('[role="alert"]');
      assert(
        !alert.textContent?.includes('fixture-only-secret'),
        'Raw transport error leaked a credential',
      );
    }
  } finally {
    fixture.unmount();
  }
}

export async function loginCredentials() {
  for (const desktop of [false, true]) {
    for (const result of [false, undefined, 'reject', true] as const)
      await loginOutcome(desktop, result);
  }
}

export async function loginLinks() {
  const { Login } = await import(
    new URL('../packages/ui/src/auth/Login.tsx', import.meta.url).href
  );
  const fixture = mount(<Login desktop error="" onSubmit={async () => false} />);
  try {
    const server = element<HTMLInputElement>('input[type="url"]');
    for (const unsafe of [
      'javascript:alert(1)',
      'https://user:secret@praxis.example',
      'https://praxis.example?key=fixture-secret',
      'https://praxis.example/#fixture-secret',
      'https://praxis.example/private/fixture-secret',
      'http://remote.example',
      'not a url',
    ]) {
      inputValue(server, unsafe);
      await settle();
      assert(!fixture.container.querySelector('a'), 'Login created an unsafe server link');
    }
    inputValue(server, 'https://praxis.example/');
    await settle();
    const link = element<HTMLAnchorElement>('.login-key-help a');
    assert(link.href === 'https://praxis.example/', 'Login linked to the wrong origin');
    assert(
      link.rel.includes('noreferrer') && link.rel.includes('noopener'),
      'Link lacks isolation',
    );
  } finally {
    fixture.unmount();
  }
}
