import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LibraryProvider } from './state/Library';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LibraryProvider>
      <App />
    </LibraryProvider>
  </StrictMode>,
);

// Installierbare App: Service Worker registrieren (nur im Produktions-Build, damit Hot-Reload nicht gecacht wird).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.error('Service Worker fehlgeschlagen', err));
  });
}

// Den Browser bitten, die Daten dieser Seite nicht bei Speicherknappheit zu löschen.
navigator.storage?.persist?.().catch(() => {});
