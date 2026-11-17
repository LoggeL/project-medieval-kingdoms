/**
 * Auslieferung der Konzeptseite (docs/konzept-seite.html) unter /konzept/ neben dem Spiel unter /.
 *
 * Die Seite ist als Artifact-Fragment geschrieben (ohne doctype, html, body); hier bekommt sie ihr Gerüst. Ihre
 * Schriften verlangt sie unter /fonts/<datei>.woff2, die Dateien kommen aus den npm-Paketen @fontsource/*.
 * Genutzt vom Vite-Plugin in vite.config.ts (Build: dist/konzept/index.html und dist/fonts/, Entwicklung: Middleware)
 * und von tests/deploy/konzeptseite.test.ts. Reine Funktionen ohne Node-Abhängigkeit.
 */

/** Pfad der Konzeptseite in der Auslieferung (mit Schrägstrich, nginx leitet /konzept dorthin um). */
export const KONZEPT_PFAD = "/konzept/";

/** Gerüst um das Artifact-Fragment: doctype, Zeichensatz, Viewport, leeres Favicon (keine Anfrage nach /favicon.ico). */
export function konzeptGeruest(fragment: string): string {
  return '<!doctype html><html lang="de"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"></head><body>'
    + fragment + "</body></html>\n";
}

/** Dateinamen aller Schriften, die die Seite unter /fonts/ verlangt (sortiert, ohne Doppelte). */
export function schriftDateien(seite: string): string[] {
  return [...new Set(Array.from(seite.matchAll(/\/fonts\/([a-z0-9-]+\.woff2)/g), (m) => m[1]))].sort();
}

/** Gültiger Schriftname (schützt die Entwicklungs-Middleware vor Pfaden wie ../). */
export function istSchriftDatei(name: string): boolean {
  return /^[a-z0-9-]+-latin(-ext)?-\d{3}-(normal|italic)\.woff2$/.test(name);
}

/** Pfad der Datei im npm-Paket, relativ zu node_modules: alegreya-sans-latin-400-normal.woff2 → @fontsource/alegreya-sans/files/… */
export function schriftQuelle(datei: string): string {
  if (!istSchriftDatei(datei)) throw new Error(`Kein Schriftname: ${datei}`);
  return `@fontsource/${datei.replace(/-latin.*$/, "")}/files/${datei}`;
}

/** Verweis auf Google Fonts (öffentliche deutsche Seite: keine Anfrage an fremde Schrift-Hosts). */
export function hatGoogleFonts(text: string): boolean {
  return /fonts\.(googleapis|gstatic)\.com/.test(text);
}

/**
 * Alte Adresse des Spiels (/spiel, /spiel/…) auf die neue abbilden, Suchteil bleibt erhalten; sonst null.
 * Dieselbe Regel steht in deploy/nginx.conf (301).
 */
export function alteSpielAdresse(url: string): string | null {
  const m = /^\/spiel(?:\/([^?#]*))?(\?[^#]*)?$/.exec(url);
  return m ? `/${m[1] ?? ""}${m[2] ?? ""}` : null;
}
