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
  „Geteilte Ordner“. Alle Mitglieder können hinzufügen; was andere mit einem Eintrag tun dürfen (nur lesen / bearbeiten / auch löschen),
  stellt die Person ein, die ihn erstellt hat (Ordner vererben es). Der Besitzer darf alles, fügt Personen
  hinzu, entfernt sie oder beendet das Teilen. „!“ markiert Neues von anderen. Geöffnete geteilte Dateien sind offline lesbar.
- **„Meine Ordner“ auf allen Geräten** (Schalter im Konto): eigene Ordner werden automatisch hochgeladen („mit niemandem geteilt“)
  und erscheinen auf jedem Gerät, auf dem man angemeldet ist. Eigene Ordner stehen immer unter „Meine Ordner“,
  unter „Geteilte Ordner“ nur, was andere mit einem teilen.
- **Personen** (Personen-Symbol in jedem Ordner und jeder Datei): zeigt, wer den Ordner/die Datei sieht – getrennt nach
  „Von „Hauptordner““ (fest, nur dort änderbar) und „Nur in diesem Ordner“. Der Besitzer kann Personen hinzufügen; sie sehen dann nur
  diesen Ordner bzw. nur diese Datei (dafür entsteht ein Ordner mit ihrem Namen). Funktioniert auch mit „Auf allen Geräten“.
- **Profilbild** (Einstellungen → Konto): Bild wählen, Ausschnitt verschieben/zoomen; erscheint bei Personen und „von …“ an geteilten Einträgen.
- **Konto löschen**: Eigene geteilte Ordner gehen an eine gewählte Person (oder werden gelöscht). Sie sieht einen Hinweis und kann
  übernehmen – weiter geteilt als Besitzer oder in „Meine Ordner“ auf ihr Gerät – oder ablehnen. Nach 30 Tagen ohne Entscheidung wird alles gelöscht.
- **Text-Dokumente**: Überschriften, Listen, Bilder, Formeln und **Checklisten**. Häkchen gehören dem Konto (auf allen eigenen
  Geräten gleich, andere sehen sie nicht); in geteilten Ordnern lässt sich pro Checkliste „Gemeinsam“ wählen – dann gelten die Häkchen für alle.
- **Diagramme**: Säulen, Balken, Linie, Kreis, Ring – Werte als Tabelle oder als Text („Mathe: 12“ pro Zeile). „Kopieren“ legt das
  Diagramm in die Zwischenablage (auch als Bild für andere Apps); in einem Text-Dokument einfügen (Strg+V bzw. lange tippen → Einfügen)
  oder dort über das Diagramm-Symbol in der Leiste. Eingefügte Diagramme lassen sich im Dokument antippen und bearbeiten.
- **Glücksrad**: Einträge als Liste oder Text („×2“ = doppelt so großes Feld), optional „Gezogene entfernen“. Kopieren und in
  Text-Dokumente einfügen wie Diagramme – dort ist es drehbar (jede Person dreht für sich).
- **Karteikarten wiederholen**: „Wiederholen“ zeigt nur fällige Karten; Gewusst → immer längere Abstände (1, 3, 7, 14, 30, 60 Tage),
  Unsicher → morgen, Nochmal → gleich wieder. Lernstand pro Person, auf dem Server auf allen eigenen Geräten gleich.
- **Kommentare** an Dateien auf dem Server (geteilt / „Auf allen Geräten“): kommentieren, antworten, löschen; Anzahl und „neu“ in der Liste.
- **Was hat sich geändert?** Speichert jemand eine geteilte Datei, sehen die anderen beim nächsten Öffnen einmal, wer was geändert hat
  (stark vereinfacht, z. B. „+120 Wörter, −1 Bild“) – auch in der Liste unter dem Namen. Haben es alle gesehen, wird es gelöscht.
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
3. *SQL Editor*: Inhalt von `supabase/schema.sql` einfügen und ausführen (Tabellen, Rechte, Dateispeicher),
   danach genauso `supabase/002_rechte.sql` (Rechte pro Datei/Ordner)
   , `supabase/003_verschachtelt.sql` (geteilte Ordner in geteilten Ordnern)
   , `supabase/004_konto_loeschen.sql` (Konto löschen & geteilte Ordner übergeben)
   , `supabase/005_checklisten.sql` (Häkchen in Checklisten pro Konto bzw. gemeinsam)
   , `supabase/006_profilbilder.sql` (Profilbilder)
   , `supabase/007_rechte_vererben.sql` (Rechte einheitlich vererben, auch vom obersten Ordner)
   , `supabase/008_oberster_ordner.sql` (obersten geteilten Ordner ändert nur der Besitzer)
   , `supabase/009_lernstand_kommentare.sql` (Lernstand bei Karteikarten, Kommentare)
   , `supabase/010_aenderungen.sql` („Was hat sich geändert?“ bei geteilten Dateien)
   und `supabase/011_speicher.sql` (belegten Server-Speicher anzeigen und vor Uploads prüfen).
4. Projekt-URL und *publishable/anon key* in `src/cloud/supabase.ts` eintragen.

Ohne Eintrag in `src/cloud/supabase.ts` funktioniert die App wie bisher, nur ohne Teilen.
