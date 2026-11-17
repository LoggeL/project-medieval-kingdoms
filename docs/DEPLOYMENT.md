# Deployment

> Stand 17.11.2026: **vorbereitet, noch nicht live.** Image lokal gebaut und im Browser geprüft. GitHub-Repo und Dokploy-Anwendung sind noch nicht angelegt.

Ausgeliefert wird nur die Konzeptseite (`docs/konzept-seite.html`), nach dem Muster der anderen Projekte auf dokploy.logge.top.

- **Image:** `Dockerfile` im Projektstamm, nginx (alpine) auf Port 8080. Beim Bauen bekommt die Seite ein vollständiges HTML-Gerüst (doctype, `charset`, `viewport`), denn sie ist als Artifact-Fragment geschrieben. `.dockerignore` lässt nur Dockerfile, `deploy/nginx.conf` und die Seite in den Build.
- **nginx:** `deploy/nginx.conf` mit UTF-8, gzip, `/healthz` (200 „ok“), `noindex` per Header und `robots.txt`, `Cache-Control: no-cache` für die Seite.
- **Dokploy (geplant):** Projekt und Anwendung `medieval-kingdoms`, GitHub-Provider, Branch `main`, Build-Typ Dockerfile, Container-Port 8080, Domain mit HTTPS über Let's Encrypt, Auto-Deploy bei Push.
- **Veröffentlichen:** nur per `git push origin main`, keine manuellen Deployments.

Lokal prüfen:

```bash
docker build -t mk-konzept . && docker run --rm -p 127.0.0.1:18080:8080 mk-konzept
```

Danach http://127.0.0.1:18080/ öffnen, `/healthz` muss „ok“ liefern.

Vor jedem Push die Seite neu bauen (`python3 tools/konzeptseite/build.py`), denn das Image nimmt die eingecheckte `docs/konzept-seite.html`.
