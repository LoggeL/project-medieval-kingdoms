# Deployment

- Live: https://medieval-kingdoms.logge.top (Healthcheck: `/healthz`), seit 17.11.2026
- Quelle: öffentliches Repo https://github.com/LoggeL/project-medieval-kingdoms, Branch `main`
- Dokploy: Projekt `medieval-kingdoms`, Anwendung `medieval-kingdoms`, Umgebung `production`, GitHub-Provider `LoggeL Github`, Trigger `push`, Auto-Deploy an

## Was ausgeliefert wird

| Pfad | Inhalt | Quelle |
|---|---|---|
| `/` | Konzeptseite | `docs/konzept-seite.html`, beim Bauen mit HTML-Gerüst versehen |
| `/fonts/` | Schriften der Konzeptseite (woff2) | npm-Pakete `@fontsource/*`, im Build kopiert |
| `/spiel/` | spielbarer Prototyp | Vite-Build aus `index.html`, `src/`, `assets/` |
| `/spiel` | 301 auf `/spiel/` | nginx |
| `/healthz`, `/robots.txt` | „ok“ bzw. `Disallow: /` | nginx |

Die Konzeptseite verlinkt oben unter dem Einleitungstext mit „Prototyp spielen“ auf `/spiel/`. Das Spiel selbst hat keinen Rücklink.

## Schriften: selbst gehostet

Keine Anfrage an Google Fonts (öffentliche deutsche Seite, DSGVO). Spiel und Konzeptseite nutzen dieselben Familien und Schnitte wie vorher bei Google: Alegreya Sans 400/500/700 und 400 kursiv, Jacquarda Bastarda 9, Pixelify Sans 400/600/700, jeweils die Teilmengen latin und latin-ext mit `unicode-range`. Lizenz der Schriften: SIL Open Font License 1.1.

- **Quelle:** `@fontsource/alegreya-sans`, `@fontsource/jacquarda-bastarda-9`, `@fontsource/pixelify-sans` als devDependencies (feste Version in `package.json`).
- **Spiel:** `src/ui/fonts.css` enthält die `@font-face`-Regeln mit Paketpfaden, `index.html` bindet sie ein. Vite legt die woff2-Dateien gehasht unter `/spiel/assets/` ab.
- **Konzeptseite:** Block `<!-- SCHRIFTEN -->` … `<!-- /SCHRIFTEN -->` am Anfang von `docs/konzept-seite.html` mit `@font-face` auf `/fonts/<datei>.woff2`. Das Dockerfile liest genau diese Dateinamen aus der Seite und kopiert sie aus `node_modules/@fontsource/*/files/`. Fehlt eine Datei, bricht der Build ab.
- **Absicherung im Build:** Findet sich im Vite-Build oder in der Seite noch `fonts.googleapis.com` oder `fonts.gstatic.com`, bricht der Build ab.
- Lokale Vorschau der Konzeptseite (`.local/vorschau/`, siehe `tools/konzeptseite/README.md`) hat kein `/fonts/` und zeigt deshalb die Ersatzschriften.

## Konzeptseite als Artifact

Die Seite wird zusätzlich von Hand als claude.ai-Artifact veröffentlicht. Dort sind Stylesheets nur von Google Fonts erlaubt, und `/spiel/` zeigt ins Leere. Die Artifact-Fassung deshalb aus der Repo-Datei ableiten, nicht die Repo-Datei ändern:

```bash
mkdir -p .local && python3 - <<'EOF'
import re
p = open("docs/konzept-seite.html", encoding="utf-8").read()
google = ('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Alegreya+Sans:ital,wght@0,400;0,500;0,700;1,400'
          '&family=Jacquarda+Bastarda+9&family=Pixelify+Sans:wght@400;600;700&display=swap">')
p, n = re.subn(r"<!-- SCHRIFTEN:.*?<!-- /SCHRIFTEN -->", lambda m: google, p, count=1, flags=re.S)
assert n == 1, "SCHRIFTEN-Block fehlt"
p = p.replace('href="/spiel/"', 'href="https://medieval-kingdoms.logge.top/spiel/"')
open(".local/konzept-artifact.html", "w", encoding="utf-8").write(p)
EOF
```

`.local/konzept-artifact.html` dann als Artifact veröffentlichen (`.local/` ist in `.gitignore`).

## Build-Ablauf (Dockerfile)

1. **Stage `spiel` (node:24-alpine):** `npm ci`, dann `tsc --noEmit`, `vitest run` und `vite build`. Schlägt eins davon fehl, wird nicht ausgeliefert. `MK_ZEITGRENZEN=aus` schaltet die Millisekunden-Schwellen der Lasttests (`tests/sim/perf.test.ts`) ab, weil der Build-Server langsam oder ausgelastet sein kann; die Funktionsprüfungen dieser Tests laufen weiter. Danach die Schriften der Konzeptseite nach `/app/fonts` kopieren und auf Google-Verweise prüfen.
2. **Stage nginx (nginx:1.27-alpine):** Seite mit Gerüst (doctype, `charset`, `viewport`, leeres Favicon) als `index.html`, dazu `fonts/` und der Spiel-Build unter `spiel/`.

`.dockerignore` lässt nur die nötigen Dateien in den Build-Kontext (Dockerfile, `deploy/nginx.conf`, Seite, `package*.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/`, `tests/`, `assets/` ohne die nicht genutzten Stilrichtungen).

## nginx (`deploy/nginx.conf`)

- UTF-8, gzip, `noindex` per Header und `robots.txt`, relative Weiterleitungen (`absolute_redirect off`, damit hinter dem HTTPS-Proxy kein `http://…:8080` entsteht).
- `/spiel/assets/` (gehashte Bundles und Schriften von Vite): `Cache-Control: public, max-age=2592000, immutable`, **nur** bei 200/206/304; fehlende Dateien sind 404 mit `no-store`.
- `/fonts/`: eine Woche Cache bei Erfolg, sonst 404 mit `no-store`.
- Jeder Pfad mit Dateiendung (Sprites, `sheet.json`, Musik unter `/spiel/`, sonstige Dateien unter `/`): 404, wenn es die Datei nicht gibt, kein Rückfall auf eine HTML-Seite. `Cache-Control: no-cache`.
- `/spiel/` liefert die Einstiegsseite des Spiels. Andere Pfade unter `/spiel/`, die es nicht gibt, sind 404: Das Spiel hat keine eigenen URL-Pfade, und weil es seine Dateien relativ lädt, wäre die Einstiegsseite unter einem tieferen Pfad ohnehin kaputt.
- Unter `/` fallen Pfade ohne Endung weiterhin auf die Konzeptseite zurück.

## Dokploy

Build-Typ Dockerfile (Kontext `/`), Container-Port 8080, Domain medieval-kingdoms.logge.top mit HTTPS (Let's Encrypt, davor Cloudflare über den Wildcard-Eintrag `*.logge.top`).

**Veröffentlichen:** nur per `git push origin main`, keine manuellen Deployments. Was auf `main` liegt, ist öffentlich: keine Zugangsdaten, keine Klarnamen oder privaten Nachrichten Dritter.

## Lokal prüfen

```bash
docker build -t mk-konzept . && docker run --rm -p 127.0.0.1:18080:8080 mk-konzept
```

Danach prüfen:

- http://127.0.0.1:18080/ zeigt die Konzeptseite mit den eigenen Schriften, der Knopf „Prototyp spielen“ führt nach `/spiel/`.
- `curl -sI http://127.0.0.1:18080/spiel` → 301, `Location: /spiel/`.
- `curl -sI http://127.0.0.1:18080/spiel/assets/gibtsnicht.js` → 404 mit `Cache-Control: no-store`; eine vorhandene Datei unter `/spiel/assets/` → 200 mit `immutable`.
- `curl -sI http://127.0.0.1:18080/spiel/buildings/vorgerendert/gibtsnicht.png` → 404.
- `/healthz` liefert „ok“. In den Entwicklerwerkzeugen keine Anfrage an fremde Hosts.

Vor jedem Push die Seite neu bauen (`python3 tools/konzeptseite/build.py`), denn das Image nimmt die eingecheckte `docs/konzept-seite.html`.

## Was lokal nicht verifiziert ist (Stand 17.11.2026)

Bei der Umstellung auf selbst gehostete Schriften, `/spiel` → `/spiel/` und die neuen 404-Regeln lief der Docker-Daemon lokal nicht, und ein nginx war nicht installiert. Deshalb **nicht** geprüft:

- `docker build` des neuen Dockerfiles (insbesondere die Schriften-Schleife unter busybox-`sh` und `npm ci` im Container).
- Die nginx-Konfiguration mit echtem nginx (`nginx -t`) und das tatsächliche Verhalten der Locations und Header.

Geprüft wurde stattdessen: `tsc`, `vitest`, `vite build` (ohne Google-Verweis im Ergebnis), die Schriften-Schleife mit `sh` unter macOS gegen die echten Pakete, die Syntax der nginx-Konfiguration mit dem Parser `crossplane` (Kontext und Argumentzahl der Direktiven), und Spiel und Konzeptseite im kopflosen Chrome aus einem nachgebauten Image-Verzeichnis (Schriften geladen, keine externen und keine fehlgeschlagenen Anfragen). Vor dem nächsten Push also einmal `docker build` und die Prüfliste oben laufen lassen.
