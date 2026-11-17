# Konzeptseite (/) und spielbarer Prototyp (/spiel/) hinter nginx, Port 8080.
# Dokploy baut dieses Image bei jedem Push auf main, siehe docs/DEPLOYMENT.md.

# 1. Spiel bauen (Typprüfung, Tests, Vite-Build) und Schriften der Konzeptseite einsammeln
FROM node:24-alpine AS spiel
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY tests ./tests
COPY assets ./assets
# Zeitgrenzen der Lasttests (tests/sim/perf.test.ts) hängen vom Build-Server ab und sind hier aus;
# die Funktionsprüfungen derselben Tests laufen weiter.
ENV MK_ZEITGRENZEN=aus
RUN npx tsc --noEmit && npx vitest run && npx vite build --outDir /app/dist
# Konzeptseite: genau die woff2-Dateien, die sie unter /fonts/ verlangt, aus den @fontsource-Paketen kopieren.
# Fehlt eine, bricht cp den Build ab.
COPY docs/konzept-seite.html /app/page.html
RUN mkdir -p /app/fonts && \
    for f in $(grep -o '/fonts/[a-z0-9-]*\.woff2' /app/page.html | sort -u); do \
      n="${f#/fonts/}"; cp "node_modules/@fontsource/${n%%-latin*}/files/$n" /app/fonts/ || exit 1; \
    done && \
    test -n "$(ls /app/fonts)" && \
    if grep -rlE 'fonts\.(googleapis|gstatic)\.com' /app/dist /app/page.html; then echo "Google-Fonts-Verweis gefunden" >&2; exit 1; fi

# 2. Ausliefern
FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
# Die Konzeptseite ist als Artifact-Fragment geschrieben (ohne doctype/head); hier bekommt sie ein vollständiges Gerüst.
COPY --from=spiel /app/page.html /tmp/page.html
RUN { printf '%s' '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"></head><body>'; \
      cat /tmp/page.html; printf '%s\n' '</body></html>'; } > /usr/share/nginx/html/index.html && rm /tmp/page.html
COPY --from=spiel /app/fonts /usr/share/nginx/html/fonts
COPY --from=spiel /app/dist /usr/share/nginx/html/spiel
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
