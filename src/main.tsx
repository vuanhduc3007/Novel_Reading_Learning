import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ToastProvider } from './components/Toast/ToastContext';
import './styles/global.css';

// A page opened before a deploy still runs the old build; the files it loads
// on demand (e.g. the Hán-Việt table) are gone after the deploy. Reload once
// to get the new build instead of silently running without them.
const RELOAD_KEY = 'reloaded-for-new-build';
window.addEventListener('vite:preloadError', event => {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 60_000) return; // already tried: let the error surface
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
