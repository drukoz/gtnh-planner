import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { guardHeldEnter } from './components/focus.ts';
import { startTheme } from './state/theme.ts';
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import '@fontsource/pixelify-sans/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/vt323/400.css';
import './styles.css';

// the look this browser chose, kept on the page from here on (the head script of index.html put a stored one there before this ran)
startTheme();
// a held Enter acts once, wherever its first press puts the focus (ledger ruling P2-R69a), for the page's life
guardHeldEnter();
const root = document.getElementById('root');
if (root === null) throw new Error('index.html has no #root element');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
