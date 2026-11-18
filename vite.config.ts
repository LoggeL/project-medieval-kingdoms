import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";
import { alteSpielAdresse, hatGoogleFonts, istSchriftDatei, konzeptGeruest, schriftDateien, schriftQuelle } from "./deploy/konzeptseite";
import { buildingFiles, figureFiles, pngHeight, terrainFiles } from "./src/render/sheet-files";
import { STYLE } from "./src/render/style";

// Das Spiel liegt im Projektstamm (index.html, src/). Die Sprites aus assets/ werden unverändert
// unter der Basis-URL ausgeliefert (publicDir = assets, also z. B. ./buildings/vorgerendert/sheet.json), damit Blender-Pipeline und Spiel dieselben Dateien nutzen.
// Im Build bleibt nur, was das Spiel lädt (Plugin spielAssets unten).
// Die Konzeptseite (docs/konzept-seite.html) liegt unter /konzept/, ihre Schriften unter /fonts/ (Plugin konzeptSeite).

/** Dateien und Ordner unter dir (rekursiv), Größe in Bytes. */
function size(dir: string): { bytes: number; files: number } {
  let bytes = 0, files = 0;
  if (!existsSync(dir)) return { bytes, files };
  for (const name of readdirSync(dir)) {
    const p = join(dir, name), st = statSync(p);
    if (st.isDirectory()) { const s = size(p); bytes += s.bytes; files += s.files; } else { bytes += st.size; files++; }
  }
  return { bytes, files };
}

/**
 * Nach dem Build alles aus dem kopierten publicDir entfernen, was das Spiel nie lädt:
 * andere Stilrichtungen als STYLE (buildings, figures, terrain), Zwischenschritte (_steps), Einzelbilder der Figuren neben
 * einem atlas.png, der alle Einheiten enthält (sonst bleiben sie, der Lader nutzt dann sie), Gebäudebilder ohne Eintrag
 * im sheet.json, Geländebilder ohne Verweis im sheet.json, ui/quelle (Rohbilder) und sonstige Dateien außerhalb der
 * bekannten Ordner. audio/ und ui/ (ohne quelle) bleiben vollständig.
 */
function spielAssets(): Plugin {
  let outDir = "dist";
  let root = process.cwd();
  return {
    name: "spiel-assets",
    apply: "build",
    configResolved(c) { outDir = c.build.outDir; root = c.root; },
    closeBundle() {
      const out = resolve(root, outDir);
      const before = size(out);
      const rm = (p: string) => rmSync(p, { recursive: true, force: true });
      const keepTop = new Set(["buildings", "figures", "terrain", "ui", "audio", "assets", "index.html", "konzept", "fonts"]);
      // Vite legt JS/CSS unter assets/ ab; die Sprite-Ordner liegen direkt unter outDir
      for (const name of readdirSync(out)) if (!keepTop.has(name)) rm(join(out, name));
      for (const art of ["buildings", "figures", "terrain"]) {
        const dir = join(out, art);
        if (!existsSync(dir)) continue;
        for (const name of readdirSync(dir)) if (name !== STYLE) rm(join(dir, name));
      }
      const json = (p: string) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
      const keepOnly = (dir: string, keep: Set<string>) => {
        if (!existsSync(dir)) return;
        for (const name of readdirSync(dir)) if (!keep.has(name)) rm(join(dir, name));
      };
      // Figuren, Gebäude, Gelände: genau die Dateien, die der Lader verlangt (src/render/sheet-files.ts). Einzelbilder der
      // Figuren bleiben, solange atlas.png nicht alle Einheiten enthält; dann lädt das Spiel sie statt des Atlas.
      const fdir = join(out, "figures", STYLE), fmeta = json(join(fdir, "sheet.json"));
      if (fmeta) {
        const atlas = join(fdir, "atlas.png");
        keepOnly(fdir, new Set(figureFiles(fmeta, existsSync(atlas) ? pngHeight(readFileSync(atlas)) : null)));
      }
      const bdir = join(out, "buildings", STYLE), bmeta = json(join(bdir, "sheet.json"));
      if (bmeta) keepOnly(bdir, new Set(buildingFiles(bmeta)));
      const tdir = join(out, "terrain", STYLE), tmeta = json(join(tdir, "sheet.json"));
      if (tmeta) keepOnly(tdir, new Set(terrainFiles(tmeta)));
      // Was der Lader verlangt, muss nach dem Ausdünnen da sein; sonst fehlen im ausgelieferten Spiel Figuren oder Gelände
      const fehlt = [
        ...(fmeta ? figureFiles(fmeta, existsSync(join(fdir, "atlas.png")) ? pngHeight(readFileSync(join(fdir, "atlas.png"))) : null).map((f) => join(fdir, f)) : []),
        ...(bmeta ? buildingFiles(bmeta).map((f) => join(bdir, f)) : []),
        ...(tmeta ? terrainFiles(tmeta).map((f) => join(tdir, f)) : []),
      ].filter((p) => !existsSync(p));
      if (fehlt.length) throw new Error(`[spiel-assets] Im Build fehlen Sprite-Dateien, die das Spiel lädt: ${fehlt.join(", ")}`);
      rm(join(out, "ui", "quelle"));
      const after = size(out);
      const mb = (b: number) => (b / 1048576).toFixed(1) + " MB";
      console.log(`[spiel-assets] Build ausgedünnt: ${mb(before.bytes)} (${before.files} Dateien) → ${mb(after.bytes)} (${after.files} Dateien)`);
    },
  };
}

/**
 * Konzeptseite neben dem Spiel: Build schreibt dist/konzept/index.html (mit Gerüst) und genau die Schriften nach
 * dist/fonts/, die die Seite verlangt (aus node_modules/@fontsource). Fehlt eine Schrift oder steht ein Google-Fonts-
 * Verweis in der Seite, bricht der Build ab. Im Dev-Server (und in vite preview) gelten dieselben Adressen wie im
 * ausgelieferten Image: /konzept → /konzept/, /spiel und /spiel/… → / (301), siehe deploy/nginx.conf.
 */
function konzeptSeite(): Plugin {
  let root = process.cwd();
  const seite = () => readFileSync(resolve(root, "docs/konzept-seite.html"), "utf8");
  const weiter = (res: ServerResponse, ziel: string) => { res.statusCode = 301; res.setHeader("Location", ziel); res.end(); };
  const umleiten = (req: IncomingMessage, res: ServerResponse): boolean => {
    const url = req.url ?? "/";
    const alt = alteSpielAdresse(url);
    if (alt) { weiter(res, alt); return true; }
    const m = /^\/konzept(\?.*)?$/.exec(url);
    if (m) { weiter(res, "/konzept/" + (m[1] ?? "")); return true; }
    return false;
  };
  return {
    name: "konzept-seite",
    configResolved(c) { root = c.root; },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (umleiten(req, res)) return;
        const pfad = (req.url ?? "/").split("?")[0];
        if (pfad === "/konzept/" || pfad === "/konzept/index.html") {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache");
          res.end(konzeptGeruest(seite()));
          return;
        }
        const f = /^\/fonts\/([^/]+)$/.exec(pfad);
        if (f) {
          const datei = istSchriftDatei(f[1]) ? resolve(root, "node_modules", schriftQuelle(f[1])) : null;
          if (!datei || !existsSync(datei)) { res.statusCode = 404; res.end(); return; }
          res.setHeader("Content-Type", "font/woff2");
          res.end(readFileSync(datei));
          return;
        }
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => { if (!umleiten(req, res)) next(); });
    },
    generateBundle() {
      const s = seite();
      if (hatGoogleFonts(s)) this.error("docs/konzept-seite.html verweist auf Google Fonts");
      const schriften = schriftDateien(s);
      if (!schriften.length) this.error("docs/konzept-seite.html verlangt keine Schriften unter /fonts/ (SCHRIFTEN-Block fehlt?)");
      this.emitFile({ type: "asset", fileName: "konzept/index.html", source: konzeptGeruest(s) });
      for (const name of schriften) {
        const datei = resolve(root, "node_modules", schriftQuelle(name));
        if (!existsSync(datei)) this.error(`Schrift fehlt: ${datei}`);
        this.emitFile({ type: "asset", fileName: `fonts/${name}`, source: readFileSync(datei) });
      }
    },
  };
}

export default defineConfig({
  base: "./",
  publicDir: "assets",
  plugins: [konzeptSeite(), spielAssets()],
  server: { port: 5173, host: "127.0.0.1" },
  build: { outDir: "dist", assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
  // Lange Simulationsläufe (Dauerlauf, Überfälle, vier Ausrichtungen) brauchen auf einer ausgelasteten Maschine mehr als
  // die 5 s, die Vitest je Test vorgibt; die Prüfungen selbst bleiben gleich (Zeitgrenzen in perf.test.ts eigens).
  test: { include: ["tests/**/*.test.ts"], environment: "node", testTimeout: 30_000 },
} as never);
