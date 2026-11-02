import { App } from '@praxis/ui';
import { createRoot } from 'react-dom/client';
document.documentElement.dataset.theme = localStorage.getItem('praxis-theme') ?? 'system';
document.documentElement.style.setProperty(
  '--message-font',
  `${localStorage.getItem('praxis-font') ?? '16'}px`,
);
createRoot(document.getElementById('root')!).render(<App />);
