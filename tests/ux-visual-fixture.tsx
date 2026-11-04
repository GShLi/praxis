import { mount } from './ux-visual-browser.tsx';
import { outlineControls } from './ux-visual-controls.tsx';
import { connectionStates } from './ux-visual-connection.tsx';
import { dropdownKeyboard, dropdownInModal, dropdownPlacement } from './ux-visual-dropdown.tsx';
export { dropdownPreview } from './ux-visual-dropdown.tsx';
import { compoundFocus, compactComposer } from './ux-visual-focus.tsx';
import { groupedModels, defaultModelFallback } from './ux-visual-model-groups.tsx';
import { loginCredentials, loginLinks } from './ux-visual-login.tsx';
import {
  modelSearchAndSelection,
  modelKeyboardAndDefault,
  modelNameWrapping,
} from './ux-visual-model-select.tsx';
import { secondaryContrast, focusAndLayout, reducedMotion } from './ux-visual-readability.tsx';

export async function run() {
  await import(new URL('../packages/ui/src/settings.css', import.meta.url).href);
  await import(new URL('../packages/ui/src/styles.css', import.meta.url).href);
  const failures: string[] = [];
  for (const scenario of [
    loginCredentials,
    loginLinks,
    secondaryContrast,
    modelSearchAndSelection,
    modelKeyboardAndDefault,
    modelNameWrapping,
    groupedModels,
    defaultModelFallback,
    focusAndLayout,
    reducedMotion,
    outlineControls,
    connectionStates,
    dropdownKeyboard,
    dropdownInModal,
    dropdownPlacement,
    compoundFocus,
    compactComposer,
  ]) {
    try {
      await scenario();
    } catch (error) {
      failures.push(`${scenario.name}: ${String(error)}`);
    }
  }
  return failures;
}

export async function preview(mode: 'desktop' | 'web' | 'models', theme = 'light') {
  await import(new URL('../packages/ui/src/styles.css', import.meta.url).href);
  const { Login } = await import(
    new URL('../packages/ui/src/auth/Login.tsx', import.meta.url).href
  );
  const { ModelSelect } = await import(
    new URL('../packages/ui/src/conversation/ModelSelect.tsx', import.meta.url).href
  );
  document.documentElement.dataset.theme = theme;
  if (mode !== 'models') {
    mount(<Login desktop={mode === 'desktop'} error="" onSubmit={async () => false} />);
    return;
  }
  const model = 'organization/full-model-name-with-reasoning-version-2026-11-04';
  mount(
    <div style={{ padding: 24, maxWidth: 460 }}>
      <ModelSelect
        choices={[
          { id: 'one', name: `Provider One · ${model}`, model, enabled: true },
          { id: 'two', name: 'Provider Two · quick-model', model: 'quick-model', enabled: true },
        ]}
        value="one"
        onChange={() => {}}
      />
    </div>,
  );
  document.querySelector<HTMLButtonElement>('.praxis-dropdown-trigger')?.click();
}
