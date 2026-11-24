import { createRoot } from 'react-dom/client';
import App from './App';
import { applyDocumentTheme } from './theme';
import './theme-controls.css';

applyDocumentTheme();

createRoot(document.getElementById('root')!).render(<App />);
