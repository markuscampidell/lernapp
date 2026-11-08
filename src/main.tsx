import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LibraryProvider } from './state/Library';
import { AuthProvider } from './cloud/auth';
import { navigate } from './lib/router';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <LibraryProvider>
        <App />
      </LibraryProvider>
    </AuthProvider>
  </StrictMode>,
);

// Installierbare App: Service Worker registrieren (nur im Produktions-Build, damit Hot-Reload nicht gecacht wird).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.error('Service Worker fehlgeschlagen', err));
  });
  // Benachrichtigung angetippt, während die App schon offen ist -> dorthin wechseln.
  navigator.serviceWorker.addEventListener('message', (e) => {
    const data = e.data as { type?: string; hash?: string } | null;
    if (data?.type === 'lernapp:open' && typeof data.hash === 'string' && data.hash.startsWith('#')) navigate(data.hash);
  });
}

// Den Browser bitten, die Daten dieser Seite nicht bei Speicherknappheit zu löschen.
navigator.storage?.persist?.().catch(() => {});
