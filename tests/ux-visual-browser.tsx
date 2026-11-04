import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { ReactNode } from 'react';

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function inputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 30));

export function deferred<T>() {
  const controls: { resolve?: (value: T) => void; reject?: (error: Error) => void } = {};
  const promise = new Promise<T>((resolve, reject) => {
    controls.resolve = resolve;
    controls.reject = reject;
  });
  assert(controls.resolve && controls.reject, 'Promise executor did not run');
  return { promise, resolve: controls.resolve, reject: controls.reject };
}

export function mount(content: ReactNode) {
  const container = document.getElementById('root');
  assert(container, 'Missing fixture root');
  const root = createRoot(container);
  const render = (next: ReactNode) => flushSync(() => root.render(next));
  render(content);
  return { container, render, unmount: () => root.unmount() };
}

export function element<T extends Element>(selector: string) {
  const result = document.querySelector<T>(selector);
  assert(result, `Missing element ${selector}`);
  return result;
}
