import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import '@fontsource-variable/plus-jakarta-sans';
import './ui/theme.css';
import './ui/shell.css';

createRoot(document.getElementById('root')!).render(<App />);
