import { useRef, useState } from 'react';
import { Icon, type IconName } from './components/Icon';
import { InstallBanner } from './components/InstallBanner';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FoldersView } from './features/folders/FoldersView';
import { UploadView } from './features/upload/UploadView';
import { AiView } from './features/ai/AiView';
import { SettingsView } from './features/settings/SettingsView';
import { navigate, useRoute, type Tab } from './lib/router';
import { useLibrary } from './state/Library';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'ordner', label: 'Ordner', icon: 'folder' },
  { id: 'hochladen', label: 'Hochladen', icon: 'upload' },
  { id: 'ki', label: 'KI', icon: 'ai' },
  { id: 'einstellungen', label: 'Einstellungen', icon: 'settings' },
];

export function App() {
  const route = useRoute();
  const { ready, error } = useLibrary();
  const tab = route.tab;
  // Richtung des letzten Tabwechsels (für die Einschub-Animation).
  const [slide, setSlide] = useState<'left' | 'right' | null>(null);

  const go = (t: Tab, from: 'tap' | 'swipe' = 'tap') => {
    const dir = TABS.findIndex((x) => x.id === t) > TABS.findIndex((x) => x.id === tab) ? 'left' : 'right';
    setSlide(from === 'swipe' && t !== tab ? dir : null);
    // Erneutes Tippen auf "Ordner" führt zurück zur Übersicht.
    navigate(`#${t}`);
    window.scrollTo({ top: 0 });
  };

  // Nach links/rechts wischen wechselt zwischen den Tabs.
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (e.touches.length !== 1 || target.closest('.sheet-backdrop, input, textarea, select, .viewer, [data-no-swipe]')) {
      touch.current = null;
      return;
    }
    const p = e.touches[0];
    touch.current = { x: p.clientX, y: p.clientY, t: Date.now() };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const p = e.changedTouches[0];
    const dx = p.clientX - start.x;
    const dy = p.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5 || Date.now() - start.t > 700) return;
    const i = TABS.findIndex((x) => x.id === tab);
    const next = TABS[i + (dx < 0 ? 1 : -1)];
    if (next) go(next.id, 'swipe');
  };

  return (
    <div className="app" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <nav className="nav" aria-label="Bereiche">
        <div className="nav-brand">Lernapp</div>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`nav-item ${tab === t.id ? 'active' : ''}`}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => go(t.id)}
          >
            <Icon name={t.icon} size={22} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <main className={`main${slide ? ` slide-${slide}` : ''}`} key={`${tab}:${route.folderId ?? ''}`}>
        <InstallBanner />
        {error && <div className="notice critical">{error}</div>}
        {!ready ? (
          <p className="muted">Lädt …</p>
        ) : (
          <ErrorBoundary>
            {tab === 'ordner' && <FoldersView folderId={route.folderId} />}
            {tab === 'hochladen' && <UploadView />}
            {tab === 'ki' && <AiView />}
            {tab === 'einstellungen' && <SettingsView />}
          </ErrorBoundary>
        )}
      </main>
    </div>
  );
}
