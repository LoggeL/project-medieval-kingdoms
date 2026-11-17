# Spiel (/) mit Konzeptseite (/konzept/) und deren Schriften (/fonts/) hinter nginx, Port 8080.
# Dokploy baut dieses Image bei jedem Push auf main, siehe docs/DEPLOYMENT.md.

# 1. Spiel bauen (Typprüfung, Tests, Vite-Build). Der Build legt auch konzept/index.html (Konzeptseite mit Gerüst)
#    und fonts/ (genau die Schriften, die die Seite verlangt, aus den @fontsource-Paketen) an, siehe vite.config.ts.
FROM node:24-alpine AS spiel
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY deploy/konzeptseite.ts ./deploy/
COPY docs/konzept-seite.html ./docs/
COPY src ./src
COPY tests ./tests
COPY assets ./assets
# Zeitgrenzen der Lasttests (tests/sim/perf.test.ts) hängen vom Build-Server ab und sind hier aus;
# die Funktionsprüfungen derselben Tests laufen weiter.
ENV MK_ZEITGRENZEN=aus
RUN npx tsc --noEmit && npx vitest run && npx vite build --outDir /app/dist
# Absicherung: Konzeptseite und Schriften sind da, nirgends ein Verweis auf Google Fonts
RUN test -s /app/dist/index.html && test -s /app/dist/konzept/index.html && test -n "$(ls /app/dist/fonts)" && \
    if grep -rlE 'fonts\.(googleapis|gstatic)\.com' /app/dist; then echo "Google-Fonts-Verweis gefunden" >&2; exit 1; fi

# 2. Ausliefern
FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=spiel /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
