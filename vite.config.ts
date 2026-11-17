import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { STYLE } from "./src/render/style";

// Das Spiel liegt im Projektstamm (index.html, src/). Die Sprites aus assets/ werden unverändert
// unter der Basis-URL ausgeliefert (publicDir = assets, also z. B. ./buildings/vorgerendert/sheet.json), damit Blender-Pipeline und Spiel dieselben Dateien nutzen.
// Im Build bleibt nur, was das Spiel lädt (Plugin spielAssets unten).

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
 * atlas.png, Gebäudebilder ohne Eintrag im sheet.json, ui/quelle (Rohbilder) und sonstige Dateien außerhalb der
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
      const keepTop = new Set(["buildings", "figures", "terrain", "ui", "audio", "assets", "index.html"]);
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
      // Figuren: sheet.json + atlas.png (Einzelbilder nur, wenn es keinen Atlas gibt)
      const fdir = join(out, "figures", STYLE), fmeta = json(join(fdir, "sheet.json"));
      if (fmeta) {
        const keep = new Set(["sheet.json"]);
        if (existsSync(join(fdir, "atlas.png"))) keep.add("atlas.png");
        else for (const u of fmeta.units ?? []) keep.add(`${u.key}.png`);
        keepOnly(fdir, keep);
      }
      // Gebäude: sheet.json + je Eintrag <key>.png und <key>_front.png
      const bdir = join(out, "buildings", STYLE), bmeta = json(join(bdir, "sheet.json"));
      if (bmeta) {
        const keep = new Set(["sheet.json"]);
        for (const u of bmeta.units ?? []) { keep.add(`${u.key}.png`); if (u.front) keep.add(`${u.key}_front.png`); }
        keepOnly(bdir, keep);
      }
      // Gelände: sheet.json + Kachelbild + Übergangsmasken
      const tdir = join(out, "terrain", STYLE), tmeta = json(join(tdir, "sheet.json"));
      if (tmeta) keepOnly(tdir, new Set(["sheet.json", tmeta.image || "terrain.png", ...(tmeta.blend?.image ? [tmeta.blend.image] : [])]));
      rm(join(out, "ui", "quelle"));
      const after = size(out);
      const mb = (b: number) => (b / 1048576).toFixed(1) + " MB";
      console.log(`[spiel-assets] Build ausgedünnt: ${mb(before.bytes)} (${before.files} Dateien) → ${mb(after.bytes)} (${after.files} Dateien)`);
    },
  };
}

export default defineConfig({
  base: "./",
  publicDir: "assets",
  plugins: [spielAssets()],
  server: { port: 5173, host: "127.0.0.1" },
  build: { outDir: "dist", assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
} as never);
