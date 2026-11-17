# Deployment

- Live: https://medieval-kingdoms.logge.top (Healthcheck: `/healthz`), seit 17.11.2026
- Quelle: öffentliches Repo https://github.com/LoggeL/project-medieval-kingdoms, Branch `main`
- Dokploy: Projekt `medieval-kingdoms`, Anwendung `medieval-kingdoms`, Umgebung `production`, GitHub-Provider `LoggeL Github`, Trigger `push`, Auto-Deploy an

## Was ausgeliefert wird

Seit 17.11.2026 (ADR [0007](decisions/0007-adressen-der-auslieferung.md)) landet die Hauptadresse direkt im Spiel, die Konzeptseite ist ein Menüpunkt.

| Pfad | Inhalt | Quelle |
|---|---|---|
| `/` | spielbarer Prototyp (Lade- und Titelbildschirm) | Vite-Build aus `index.html`, `src/`, `assets/` |
| `/konzept/` | Konzeptseite (Design-Dokument) | `docs/konzept-seite.html`, im Vite-Build mit HTML-Gerüst versehen |
| `/konzept` | 301 auf `/konzept/` | nginx |
| `/fonts/` | Schriften der Konzeptseite (woff2) | npm-Pakete `@fontsource/*`, im Vite-Build kopiert |
| `/spiel`, `/spiel/…` | 301 auf `/…` (alte Adressen, Suchteil bleibt: `/spiel/?direkt=1` → `/?direkt=1`) | nginx |
| `/healthz`, `/robots.txt` | „ok“ bzw. `Disallow: /` | nginx |

Der Titelbildschirm hat den Menüpunkt „Design-Dokument“ (Link `./konzept/`). Die Konzeptseite verlinkt ganz oben mit „Zum Spiel“ und unter dem Einleitungstext mit „Prototyp spielen“ zurück auf `/`.

Die Regeln (Gerüst, Schriftliste, Paketpfade, alte Adressen) stehen einmal in `deploy/konzeptseite.ts`. Das Vite-Plugin `konzeptSeite` in `vite.config.ts` nutzt sie im Build (schreibt `dist/konzept/index.html` und `dist/fonts/`) und im Dev-Server bzw. `vite preview` (dieselben Adressen und Weiterleitungen wie nginx, Schriften direkt aus `node_modules`). Lokal also einfach `npm run dev` und http://localhost:5173/konzept/ öffnen.

## Schriften: selbst gehostet

Keine Anfrage an Google Fonts (öffentliche deutsche Seite, DSGVO). Spiel und Konzeptseite nutzen dieselben Familien und Schnitte wie vorher bei Google: Alegreya Sans 400/500/700 und 400 kursiv, Jacquarda Bastarda 9, Pixelify Sans 400/600/700, jeweils die Teilmengen latin und latin-ext mit `unicode-range`. Lizenz der Schriften: SIL Open Font License 1.1.

- **Quelle:** `@fontsource/alegreya-sans`, `@fontsource/jacquarda-bastarda-9`, `@fontsource/pixelify-sans` als devDependencies (feste Version in `package.json`).
- **Spiel:** `src/ui/fonts.css` enthält die `@font-face`-Regeln mit Paketpfaden, `index.html` bindet sie ein. Vite legt die woff2-Dateien gehasht unter `/assets/` ab.
- **Konzeptseite:** Block `<!-- SCHRIFTEN -->` … `<!-- /SCHRIFTEN -->` am Anfang von `docs/konzept-seite.html` mit `@font-face` auf `/fonts/<datei>.woff2`. Der Vite-Build liest genau diese Dateinamen aus der Seite und kopiert sie aus `node_modules/@fontsource/*/files/` nach `dist/fonts/`. Fehlt eine Datei, bricht der Build ab.
- **Absicherung im Build:** Steht in der Seite `fonts.googleapis.com` oder `fonts.gstatic.com`, bricht schon `vite build` ab; das Dockerfile prüft danach den ganzen Build noch einmal.
- Im Dev-Server (`npm run dev`) zeigt `/konzept/` die Seite mit den echten Schriften. Die ältere Vorschau über `.local/vorschau/` (siehe `tools/konzeptseite/README.md`) hat kein `/fonts/` und zeigt Ersatzschriften.

## Konzeptseite als Artifact

Die Seite wird zusätzlich von Hand als claude.ai-Artifact veröffentlicht. Dort sind Stylesheets nur von Google Fonts erlaubt, und die Links auf `/` (Spiel) zeigen ins Leere. Die Artifact-Fassung deshalb aus der Repo-Datei ableiten, nicht die Repo-Datei ändern:

```bash
mkdir -p .local && python3 - <<'EOF'
import re
p = open("docs/konzept-seite.html", encoding="utf-8").read()
google = ('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Alegreya+Sans:ital,wght@0,400;0,500;0,700;1,400'
          '&family=Jacquarda+Bastarda+9&family=Pixelify+Sans:wght@400;600;700&display=swap">')
p, n = re.subn(r"<!-- SCHRIFTEN:.*?<!-- /SCHRIFTEN -->", lambda m: google, p, count=1, flags=re.S)
assert n == 1, "SCHRIFTEN-Block fehlt"
p = p.replace('href="/"', 'href="https://medieval-kingdoms.logge.top/"')
open(".local/konzept-artifact.html", "w", encoding="utf-8").write(p)
EOF
```

`.local/konzept-artifact.html` dann als Artifact veröffentlichen (`.local/` ist in `.gitignore`).

## Build-Ablauf (Dockerfile)

1. **Stage `spiel` (node:24-alpine):** `npm ci`, dann `tsc --noEmit`, `vitest run` und `vite build`. Schlägt eins davon fehl, wird nicht ausgeliefert. `MK_ZEITGRENZEN=aus` schaltet die Millisekunden-Schwellen der Lasttests (`tests/sim/perf.test.ts`) ab, weil der Build-Server langsam oder ausgelastet sein kann; die Funktionsprüfungen dieser Tests laufen weiter. Der Build enthält schon `konzept/index.html` (Seite mit Gerüst: doctype, `charset`, `viewport`, leeres Favicon) und `fonts/`. Danach prüft ein Schritt, dass `index.html`, `konzept/index.html` und `fonts/` da sind und nirgends Google Fonts vorkommt.
2. **Stage nginx (nginx:1.27-alpine):** `dist/` unverändert als Wurzel `/usr/share/nginx/html`.

`.dockerignore` lässt nur die nötigen Dateien in den Build-Kontext (Dockerfile, `deploy/nginx.conf`, `deploy/konzeptseite.ts`, Seite, `package*.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/`, `tests/`, `assets/` ohne die nicht genutzten Stilrichtungen).

## nginx (`deploy/nginx.conf`)

- UTF-8, gzip, `noindex` per Header und `robots.txt`, relative Weiterleitungen (`absolute_redirect off`, damit hinter dem HTTPS-Proxy kein `http://…:8080` entsteht).
- `/spiel` und `/spiel/…`: 301 auf denselben Pfad ohne `/spiel` (`rewrite … permanent` hängt den Suchteil an). `/konzept`: 301 auf `/konzept/`.
- `/assets/` (gehashte Bundles und Schriften von Vite): `Cache-Control: public, max-age=2592000, immutable`, **nur** bei 200/206/304; fehlende Dateien sind 404 mit `no-store`.
- `/fonts/`: eine Woche Cache bei Erfolg, sonst 404 mit `no-store`.
- Jeder Pfad mit Dateiendung (Sprites, `sheet.json`, Musik): 404, wenn es die Datei nicht gibt, kein Rückfall auf eine HTML-Seite. `Cache-Control: no-cache`.
- `/` liefert die Einstiegsseite des Spiels, `/konzept/` die Konzeptseite (beide `no-cache`). Alle anderen Pfade ohne Datei sind 404: Das Spiel hat keine eigenen URL-Pfade, und weil es seine Dateien relativ lädt, wäre die Einstiegsseite unter einem tieferen Pfad ohnehin kaputt.
- Ohne nginx prüfbar: `tests/deploy/konzeptseite.test.ts` baut die Location-Auswahl von nginx nach und spielt die Adresstabelle durch (Weiterleitungen, 404, Zuordnung der Cache-Header).

## Dokploy

Build-Typ Dockerfile (Kontext `/`), Container-Port 8080, Domain medieval-kingdoms.logge.top mit HTTPS (Let's Encrypt, davor Cloudflare über den Wildcard-Eintrag `*.logge.top`).

**Veröffentlichen:** nur per `git push origin main`, keine manuellen Deployments. Was auf `main` liegt, ist öffentlich: keine Zugangsdaten, keine Klarnamen oder privaten Nachrichten Dritter.

## Lokal prüfen

```bash
docker build -t mk-konzept . && docker run --rm -p 127.0.0.1:18080:8080 mk-konzept
```

Danach prüfen:

- http://127.0.0.1:18080/ zeigt Lade- und Titelbildschirm, der Menüpunkt „Design-Dokument“ öffnet `/konzept/` mit den eigenen Schriften, „Zum Spiel“ führt zurück.
- `curl -sI http://127.0.0.1:18080/spiel` → 301, `Location: /`; `curl -sI 'http://127.0.0.1:18080/spiel/?direkt=1'` → 301, `Location: /?direkt=1`; `curl -sI http://127.0.0.1:18080/konzept` → 301, `Location: /konzept/`.
- `curl -sI http://127.0.0.1:18080/assets/gibtsnicht.js` → 404 mit `Cache-Control: no-store`; eine vorhandene Datei unter `/assets/` → 200 mit `immutable`.
- `curl -sI http://127.0.0.1:18080/buildings/vorgerendert/gibtsnicht.png` → 404, `curl -sI http://127.0.0.1:18080/gibtsnicht` → 404.
- `curl -sI http://127.0.0.1:18080/fonts/pixelify-sans-latin-400-normal.woff2` → 200.
- `/healthz` liefert „ok“. In den Entwicklerwerkzeugen keine Anfrage an fremde Hosts.

Vor jedem Push die Seite neu bauen (`python3 tools/konzeptseite/build.py`), denn das Image nimmt die eingecheckte `docs/konzept-seite.html`.

Ohne Docker kommt man nah heran: `npx vite build && npx vite preview` liefert `dist/` mit denselben Adressen und Weiterleitungen (nur fällt `vite preview` bei unbekannten Pfaden auf `index.html` zurück, statt 404 zu liefern).

## Was lokal nicht verifiziert ist (Stand 17.11.2026)

**Umzug Spiel nach `/`, Konzept nach `/konzept/`:** Der Docker-Daemon lief nicht, nginx ist nicht installiert. Nicht geprüft: das Image-Bauen mit dem geänderten Dockerfile und die nginx-Konfiguration mit echtem nginx (`nginx -t`, tatsächliche Weiterleitungen und Header). Geprüft: `tsc`, `vitest` (mit Nachbau der Location-Auswahl), `vite build` (Struktur `index.html`, `konzept/index.html`, `fonts/` mit 16 Schriften, keine Google-Verweise), und im kopflosen Chrome gegen `vite preview` und den Dev-Server: `/` zeigt Laden und Titel, „Design-Dokument“ öffnet `/konzept/` mit allen Schriften (keine fremden oder fehlgeschlagenen Anfragen), „Zum Spiel“ führt zurück, `/spiel/` leitet auf `/` um, „Neues Spiel“ startet das Spiel.

Ältere Umstellung (selbst gehostete Schriften, 404-Regeln; der Dokploy-Build danach lief durch und wurde live geprüft):

Bei der Umstellung auf selbst gehostete Schriften, `/spiel` → `/spiel/` und die neuen 404-Regeln lief der Docker-Daemon lokal nicht, und ein nginx war nicht installiert. Deshalb **nicht** geprüft:

- `docker build` des neuen Dockerfiles (insbesondere die Schriften-Schleife unter busybox-`sh` und `npm ci` im Container).
- Die nginx-Konfiguration mit echtem nginx (`nginx -t`) und das tatsächliche Verhalten der Locations und Header.

Geprüft wurde stattdessen: `tsc`, `vitest`, `vite build` (ohne Google-Verweis im Ergebnis), die Schriften-Schleife mit `sh` unter macOS gegen die echten Pakete, die Syntax der nginx-Konfiguration mit dem Parser `crossplane` (Kontext und Argumentzahl der Direktiven), und Spiel und Konzeptseite im kopflosen Chrome aus einem nachgebauten Image-Verzeichnis (Schriften geladen, keine externen und keine fehlgeschlagenen Anfragen). Vor dem nächsten Push also einmal `docker build` und die Prüfliste oben laufen lassen.
