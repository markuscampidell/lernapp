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
- **Teilen** (Konto mit Benutzername + Passwort): Ordner unter „Meine Ordner“ mit anderen teilen; sie erscheinen bei ihnen unter
  „Geteilte Ordner“. Alle Mitglieder können hinzufügen, aber nur Eigenes ändern/löschen; der Besitzer darf alles, fügt Personen
  hinzu, entfernt sie oder beendet das Teilen. „!“ markiert Neues von anderen. Geöffnete geteilte Dateien sind offline lesbar.
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

## Server für geteilte Ordner (Supabase, kostenlos)

Eigene Ordner bleiben auf dem Gerät. Nur geteilte Ordner und Konten liegen in [Supabase](https://supabase.com):

1. Neues Projekt anlegen (Region z. B. Frankfurt).
2. *Authentication → Sign In / Providers → Email*: **„Confirm email“ ausschalten** (Anmeldung nur mit Benutzername).
3. *SQL Editor*: Inhalt von `supabase/schema.sql` einfügen und ausführen (Tabellen, Rechte, Dateispeicher).
4. Projekt-URL und *publishable/anon key* in `src/cloud/supabase.ts` eintragen.

Ohne Eintrag in `src/cloud/supabase.ts` funktioniert die App wie bisher, nur ohne Teilen.
