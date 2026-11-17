# 0005 – Adressen der Auslieferung: Spiel unter /, Konzept unter /konzept/

**Status:** entschieden (17.11.2026, Wunsch des Auftraggebers: Wer die Hauptadresse aufruft, landet im Titelmenü; das Design-Dokument ist ein Menüpunkt).

## Kontext
Bis zum 17.11.2026 lieferte medieval-kingdoms.logge.top unter `/` die Konzeptseite und das Spiel unter `/spiel/` aus. Wer den Link weitergab, landete auf einem langen Dokument statt im Spiel. Links auf `/spiel/` sind bereits geteilt.

## Entscheidung
- **`/`** ist das Spiel (Lade- und Titelbildschirm). **`/konzept/`** ist die Konzeptseite, erreichbar über den Menüpunkt „Design-Dokument“ im Titelbildschirm; die Seite verlinkt oben mit „Zum Spiel“ und im Knopf „Prototyp spielen“ zurück auf `/`.
- **Alte Adressen** `/spiel` und `/spiel/…` leiten dauerhaft (301) auf denselben Pfad ohne `/spiel` um, der Suchteil bleibt erhalten (`/spiel/?direkt=1` → `/?direkt=1`).
- **Ein Build für alles:** `vite build` legt neben dem Spiel `konzept/index.html` (Seite mit HTML-Gerüst) und `fonts/` (genau die Schriften, die die Seite verlangt) an. Das Dockerfile kopiert nur noch `dist/` nach nginx. Die Regeln dafür stehen einmal in `deploy/konzeptseite.ts` und werden vom Vite-Plugin, vom Dev-Server und von den Tests benutzt.
- **Entwicklung wie Auslieferung:** Der Dev-Server (und `vite preview`) kennt dieselben Adressen: `/konzept/` mit Schriften aus `node_modules`, `/konzept` → `/konzept/`, `/spiel…` → `/…`. Der Menüpunkt funktioniert deshalb auch lokal.
- Das Spiel lädt seine Dateien weiter relativ (Vite `base: "./"`); es hat keine eigenen URL-Pfade, alles Unbekannte ist 404.

## Folgen
- Die nginx-Konfiguration (`deploy/nginx.conf`) ist flacher: `/assets/` mit langer Cache-Zeit, `/fonts/`, `/konzept/`, Dateien mit Endung, `/`. Kein Pfad fällt mehr auf eine HTML-Seite zurück.
- Ein Nachbau der nginx-Location-Auswahl in `tests/deploy/konzeptseite.test.ts` prüft die Adresstabelle ohne nginx. Er ersetzt nicht `nginx -t` und `docker build`.
- Die Artifact-Fassung der Konzeptseite muss die Links auf `/` absolut machen (siehe docs/DEPLOYMENT.md).
