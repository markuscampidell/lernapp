import { Component, type ReactNode } from 'react';

/** Fängt Abstürze ab, damit nie ein leerer Bildschirm bleibt. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="view">
        <div className="empty">
          <p className="empty-title">Hoppla, da ist etwas schiefgelaufen.</p>
          <p className="muted small">Deine Ordner und Dateien sind sicher gespeichert.</p>
          <p className="muted small mono">{this.state.error.message}</p>
          <div className="input-row center">
            <button className="btn primary" onClick={() => this.setState({ error: null })}>
              Erneut versuchen
            </button>
            <button className="btn ghost" onClick={() => location.reload()}>
              Neu laden
            </button>
          </div>
        </div>
      </div>
    );
  }
}
