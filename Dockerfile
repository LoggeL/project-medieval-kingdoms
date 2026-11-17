# Statische Konzeptseite (docs/konzept-seite.html) hinter nginx, Port 8080.
# Dokploy baut dieses Image bei jedem Push auf main, siehe docs/DEPLOYMENT.md.
FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
# Die Seite ist als Artifact-Fragment geschrieben (ohne doctype/head); hier bekommt sie ein vollständiges Gerüst.
COPY docs/konzept-seite.html /tmp/page.html
RUN { printf '%s' '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>'; \
      cat /tmp/page.html; printf '%s\n' '</body></html>'; } > /usr/share/nginx/html/index.html && rm /tmp/page.html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
