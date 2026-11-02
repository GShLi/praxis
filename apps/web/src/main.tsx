import { createRoot } from 'react-dom/client';
import { App } from '../../../packages/ui/src/App.tsx';
document.documentElement.dataset.theme = localStorage.getItem('praxis-theme') ?? 'system';
createRoot(document.getElementById('root')!).render(<App />);
