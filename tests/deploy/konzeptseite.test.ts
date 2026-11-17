import { describe, expect, it } from "vitest";
import {
  alteSpielAdresse, hatGoogleFonts, istSchriftDatei, konzeptGeruest, KONZEPT_PFAD, schriftDateien, schriftQuelle,
} from "../../deploy/konzeptseite";
import seite from "../../docs/konzept-seite.html?raw";
import nginxConf from "../../deploy/nginx.conf?raw";

describe("Konzeptseite unter /konzept/", () => {
  it("verlangt Schriften unter /fonts/, jede aus einem @fontsource-Paket", () => {
    const schriften = schriftDateien(seite);
    expect(schriften.length).toBeGreaterThanOrEqual(10);
    for (const s of schriften) {
      expect(istSchriftDatei(s), s).toBe(true);
      expect(schriftQuelle(s)).toMatch(/^@fontsource\/[a-z0-9-]+\/files\/[a-z0-9-]+\.woff2$/);
    }
    expect(schriftQuelle("jacquarda-bastarda-9-latin-ext-400-normal.woff2"))
      .toBe("@fontsource/jacquarda-bastarda-9/files/jacquarda-bastarda-9-latin-ext-400-normal.woff2");
    expect(schriftQuelle("alegreya-sans-latin-400-italic.woff2")).toBe("@fontsource/alegreya-sans/files/alegreya-sans-latin-400-italic.woff2");
  });

  it("Schriftnamen ohne Pfadanteile", () => {
    for (const bad of ["../package.json", "..%2Fx.woff2", "a/b-latin-400-normal.woff2", "x.woff2", "x-latin-400-normal.woff"]) {
      expect(istSchriftDatei(bad), bad).toBe(false);
      expect(() => schriftQuelle(bad)).toThrow();
    }
  });

  it("keine Google Fonts, Links zurück zum Spiel unter /, nichts mehr auf /spiel/", () => {
    expect(hatGoogleFonts(seite)).toBe(false);
    expect(hatGoogleFonts('<link href="https://fonts.googleapis.com/css2">')).toBe(true);
    expect(seite).not.toMatch(/href="\/spiel/);
    expect(seite).toMatch(/<a href="\/">[^]*?Zum Spiel<\/a>/);
    expect(seite).toMatch(/class="play-btn" href="\/"/);
  });

  it("Gerüst: doctype, Zeichensatz, Viewport, Fragment im body", () => {
    const html = konzeptGeruest("<p>x</p>");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('name="viewport"');
    expect(html).toContain("<body><p>x</p></body></html>");
    expect(KONZEPT_PFAD).toBe("/konzept/");
  });

  it("alte Spieladressen werden auf die neuen abgebildet", () => {
    expect(alteSpielAdresse("/spiel")).toBe("/");
    expect(alteSpielAdresse("/spiel/")).toBe("/");
    expect(alteSpielAdresse("/spiel/?direkt=1")).toBe("/?direkt=1");
    expect(alteSpielAdresse("/spiel?x=1")).toBe("/?x=1");
    expect(alteSpielAdresse("/spiel/assets/index-abc.js")).toBe("/assets/index-abc.js");
    expect(alteSpielAdresse("/spielwiese")).toBeNull();
    expect(alteSpielAdresse("/")).toBeNull();
    expect(alteSpielAdresse("/konzept/")).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// nginx-Konfiguration: nginx ist lokal nicht installiert. Ein kleiner Nachbau der Location-Auswahl (exakt „=“,
// längstes Präfix, „^~“ ohne Regex-Prüfung, sonst erste passende Regex) und der Direktiven return/rewrite/try_files
// prüft die Adresstabelle gegen eine nachgebaute Auslieferung. Das ersetzt nicht `nginx -t`, fängt aber falsche
// Reihenfolgen, vergessene Weiterleitungen und Rückfälle auf die Einstiegsseite.

interface Loc { mod: "=" | "^~" | "~" | ""; pfad: string; rumpf: string }

function locations(conf: string): Loc[] {
  const out: Loc[] = [];
  const re = /location\s+(=|\^~|~)?\s*(\S+)\s*\{([^}]*)\}/g;
  for (const m of conf.matchAll(re)) out.push({ mod: (m[1] ?? "") as Loc["mod"], pfad: m[2], rumpf: m[3] });
  return out;
}

function waehle(locs: Loc[], uri: string): Loc {
  const exakt = locs.find((l) => l.mod === "=" && l.pfad === uri);
  if (exakt) return exakt;
  const praefix = locs.filter((l) => (l.mod === "" || l.mod === "^~") && uri.startsWith(l.pfad))
    .sort((a, b) => b.pfad.length - a.pfad.length)[0];
  if (praefix?.mod === "^~") return praefix;
  const regex = locs.find((l) => l.mod === "~" && new RegExp(l.pfad.replace(/\\\\/g, "\\")).test(uri));
  return regex ?? praefix!;
}

type Antwort = { status: number; ort?: string; datei?: string; cache?: string };

function anfrage(conf: string, dateien: Set<string>, url: string): Antwort {
  const [uri, such] = url.split("?");
  const args = such ?? "";
  const loc = waehle(locations(conf), uri);
  const ret = /return\s+(\d+)\s+([^;]+);/.exec(loc.rumpf);
  if (ret) {
    const status = Number(ret[1]);
    if (status !== 301) return { status };
    const ort = ret[2].replace("$is_args$args", args ? "?" + args : "");
    return { status, ort };
  }
  const rw = /rewrite\s+(\S+)\s+(\S+)\s+permanent;/.exec(loc.rumpf);
  if (rw) {
    const m = new RegExp(rw[1]).exec(uri);
    if (m) return { status: 301, ort: rw[2].replace(/\$(\d)/g, (_, i) => m[Number(i)]) + (args ? "?" + args : "") };
  }
  const cache = /add_header Cache-Control ("[^"]+"|\S+) always;/.exec(loc.rumpf)?.[1];
  const tf = /try_files\s+([^;]+);/.exec(loc.rumpf);
  expect(tf, `keine Antwort für ${url}`).not.toBeNull();
  const teile = tf![1].trim().split(/\s+/);
  for (const t of teile.slice(0, -1)) {
    const d = t.replace("$uri", uri);
    if (dateien.has(d)) return { status: 200, datei: d, cache };
  }
  const letzte = teile[teile.length - 1];
  if (letzte === "=404") return { status: 404, cache };
  return { status: 200, datei: letzte, cache };
}

describe("nginx: Spiel unter /, Konzept unter /konzept/", () => {
  // Nachgebaute Auslieferung wie dist/ aus vite build (siehe vite.config.ts)
  const dateien = new Set([
    "/index.html", "/konzept/index.html", "/assets/index-abc123.js", "/assets/alegreya-sans-latin-400-normal-x1.woff2",
    "/fonts/alegreya-sans-latin-400-normal.woff2", "/buildings/vorgerendert/sheet.json", "/ui/holz_kachel.png",
    "/audio/titel.mp3",
  ]);
  const a = (url: string) => anfrage(nginxConf, dateien, url);

  it("Hauptadresse liefert das Spiel, nicht die Konzeptseite", () => {
    expect(a("/")).toMatchObject({ status: 200, datei: "/index.html", cache: '"no-cache"' });
    expect(a("/?direkt=1")).toMatchObject({ status: 200, datei: "/index.html" });
  });

  it("Konzeptseite unter /konzept/, /konzept leitet um", () => {
    expect(a("/konzept/")).toMatchObject({ status: 200, datei: "/konzept/index.html" });
    expect(a("/konzept")).toEqual({ status: 301, ort: "/konzept/" });
    expect(a("/konzept/gibtsnicht").status).toBe(404);
  });

  it("alte Adressen /spiel und /spiel/… leiten dauerhaft um, mit Suchteil", () => {
    expect(a("/spiel")).toEqual({ status: 301, ort: "/" });
    expect(a("/spiel/")).toEqual({ status: 301, ort: "/" });
    expect(a("/spiel/?direkt=1")).toEqual({ status: 301, ort: "/?direkt=1" });
    expect(a("/spiel/assets/index-abc123.js")).toEqual({ status: 301, ort: "/assets/index-abc123.js" });
    expect(a("/spiel/buildings/vorgerendert/sheet.json")).toEqual({ status: 301, ort: "/buildings/vorgerendert/sheet.json" });
    // Gleich nachbilden wie im Dev-Server
    for (const u of ["/spiel", "/spiel/", "/spiel/?direkt=1", "/spiel/assets/index-abc123.js"]) expect(alteSpielAdresse(u)).toBe(a(u).ort);
  });

  it("gehashte Bundles lange cachen, fehlende sind 404", () => {
    expect(a("/assets/index-abc123.js")).toMatchObject({ status: 200, cache: "$mk_cache_bundle" });
    expect(a("/assets/gibtsnicht.js")).toMatchObject({ status: 404, cache: "$mk_cache_bundle" });
    expect(nginxConf).toMatch(/default "no-store";/);
  });

  it("Schriften der Konzeptseite bleiben unter /fonts/ erreichbar", () => {
    expect(a("/fonts/alegreya-sans-latin-400-normal.woff2")).toMatchObject({ status: 200, cache: "$mk_cache_font" });
    expect(a("/fonts/gibtsnicht.woff2").status).toBe(404);
  });

  it("fehlende Dateien und unbekannte Pfade sind 404, kein Rückfall auf eine Seite", () => {
    expect(a("/buildings/vorgerendert/sheet.json").status).toBe(200);
    expect(a("/buildings/vorgerendert/gibtsnicht.png").status).toBe(404);
    expect(a("/gibtsnicht").status).toBe(404);
    expect(a("/x/y").status).toBe(404);
  });

  it("/healthz und /robots.txt bleiben", () => {
    expect(a("/healthz").status).toBe(200);
    expect(a("/robots.txt").status).toBe(200);
  });
});
