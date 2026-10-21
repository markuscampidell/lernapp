# Lernapp

Lernmaterial in Ordnern sammeln – Texte, Bilder, PDFs, Präsentationen, Videos, Audio und jede andere Datei.
Installierbar als App (PWA) auf Handy und PC, funktioniert offline. Alle Daten bleiben **nur auf dem Gerät** (IndexedDB im Browser).

## [App öffnen & installieren](https://markuscampidell.github.io/lernapp/)

**https://markuscampidell.github.io/lernapp/**

- **Android (Chrome):** Link öffnen → Banner „App installieren“ antippen, oder Menü ⋮ → *App installieren*.
- **iPhone/iPad (Safari):** Link öffnen → Teilen-Symbol → *Zum Home-Bildschirm*.
- **PC (Chrome/Edge):** Link öffnen → Installieren-Symbol rechts in der Adressleiste.

## Funktionen

- **Ordner**: Ordner mit Name, optionaler Beschreibung und Bild; Unterordner bis 6 Ebenen tief (`MAX_DEPTH` in `src/domain/types.ts`);
  Dateien in Ordnern und Unterordnern; Suche (oberste Ebene = alles, im Ordner = nur darin); Vorschau für Bilder, PDFs, Text, Video, Audio;
  Notizen direkt schreiben; Dateien/Ordner umbenennen, verschieben, löschen.
- **Hochladen**: Dateien oder Fotos auswählen, benennen/beschreiben, Zielordner wählen.
  Auf Android erscheint die installierte App im **Teilen**-Menü anderer Apps.
- **KI** (Google Gemini): Fragen zu gewählten Ordnern/Dateien mit Quellenangaben, Quiz aus mehreren Dateien.
  Der Text der gewählten Unterlagen wird dafür an Google gesendet; alles andere bleibt auf dem Gerät.
- **Einstellungen**: Speicherbelegung, Backup als ZIP exportieren/importieren, alles löschen.

## Entwickeln

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # Ergebnis in dist/
```

## Veröffentlichen (GitHub Pages, kostenlos)

1. Neues Repo auf GitHub anlegen und den Code pushen (Branch `main`).
2. Repo → Settings → Pages → Source: **GitHub Actions**.
3. Bei jedem Push baut `.github/workflows/deploy.yml` die App und veröffentlicht sie.

Nach einem Deploy mit Änderungen am Service Worker `VERSION` in `public/sw.js` erhöhen.

## KI-Server (Gemini-Schlüssel)

Der Gemini-Schlüssel liegt **nicht** im Code, sondern geheim in einem kostenlosen Cloudflare Worker (`worker/`).
Die App ruft nur diesen Worker auf. Einrichtung: siehe `worker/README.md`, danach die Worker-Adresse in `src/ai/config.ts` eintragen.
