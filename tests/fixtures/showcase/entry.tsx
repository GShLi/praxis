import { createRoot } from 'react-dom/client';
import { App } from '@praxis/ui';
import { createShowcaseClient } from './client.ts';

/** Browser entry only; screenshot bundling/capture belongs to scripts/portfolio. */
export function mountShowcase(root: HTMLElement, query = new URLSearchParams(location.search)) {
  const theme = query.get('theme') === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.documentElement.lang = 'zh-CN';
  document.documentElement.style.setProperty('--message-font', '16px');
  document.title = '知行 Praxis · 山岚工作室 · 虚构演示';
  const client = createShowcaseClient({ desktop: query.get('client') !== 'web' });
  const mounted = createRoot(root);
  mounted.render(<App client={client} />);
  return () => mounted.unmount();
}

const root = document.getElementById('root');
if (!root) throw new Error('Showcase entry requires a #root element.');
mountShowcase(root);
