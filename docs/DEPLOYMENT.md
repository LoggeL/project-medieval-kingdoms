# Deployment

- Live: https://medieval-kingdoms.logge.top (Healthcheck: `/healthz`), seit 17.11.2026
- Quelle: öffentliches Repo https://github.com/LoggeL/project-medieval-kingdoms, Branch `main`
- Dokploy: Projekt `medieval-kingdoms`, Anwendung `medieval-kingdoms`, Umgebung `production`, GitHub-Provider `LoggeL Github`, Trigger `push`, Auto-Deploy an

Ausgeliefert wird nur die Konzeptseite (`docs/konzept-seite.html`), nach dem Muster der anderen Projekte auf dokploy.logge.top.

- **Image:** `Dockerfile` im Projektstamm, nginx (alpine) auf Port 8080. Beim Bauen bekommt die Seite ein vollständiges HTML-Gerüst (doctype, `charset`, `viewport`), denn sie ist als Artifact-Fragment geschrieben. `.dockerignore` lässt nur Dockerfile, `deploy/nginx.conf` und die Seite in den Build.
- **nginx:** `deploy/nginx.conf` mit UTF-8, gzip, `/healthz` (200 „ok“), `noindex` per Header und `robots.txt`, `Cache-Control: no-cache` für die Seite.
- **Dokploy:** Build-Typ Dockerfile (Kontext `/`), Container-Port 8080, Domain medieval-kingdoms.logge.top mit HTTPS (Let's Encrypt, davor Cloudflare über den Wildcard-Eintrag `*.logge.top`).
- **Veröffentlichen:** nur per `git push origin main`, keine manuellen Deployments. Was auf `main` liegt, ist öffentlich: keine Zugangsdaten, keine Klarnamen oder privaten Nachrichten Dritter.

Lokal prüfen:

```bash
docker build -t mk-konzept . && docker run --rm -p 127.0.0.1:18080:8080 mk-konzept
```

Danach http://127.0.0.1:18080/ öffnen, `/healthz` muss „ok“ liefern.

Vor jedem Push die Seite neu bauen (`python3 tools/konzeptseite/build.py`), denn das Image nimmt die eingecheckte `docs/konzept-seite.html`.
