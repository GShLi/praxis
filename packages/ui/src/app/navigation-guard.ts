export function requestNavigation(action: () => void): boolean {
  const event = new CustomEvent('praxis:before-navigate', {
    cancelable: true,
    detail: { proceed: action },
  });
  if (!window.dispatchEvent(event)) return false;
  action();
  return true;
}
