/**
 * Der Build dünnt die Sprite-Ordner aus (vite.config.ts, Plugin spielAssets). Er behält genau, was der Lader verlangt
 * (src/render/sheet-files.ts). Hier: gegen die echten Blätter im eingestellten Stil prüfen, dass diese Dateien da sind.
 * Anlass: Der Figurenatlas enthielt nur 15 von 47 Einheiten, der Lader nahm deshalb die Einzelbilder, und der Build
 * hatte genau die entfernt; ausgeliefert fehlten alle Figuren und die neuen Geländearten.
 */
import { describe, expect, it } from "vitest";
import { atlasCovers, buildingFiles, figureFiles, figureRows, pngHeight, terrainFiles, terrainImages, type FigureFilesMeta } from "../../src/render/sheet-files";
import { STYLE } from "../../src/render/style";

const alle = Object.keys(import.meta.glob("/assets/{figures,buildings,terrain}/*/*.{png,json}"));
const blaetter = import.meta.glob("/assets/{figures,buildings,terrain}/*/sheet.json", { eager: true, import: "default" }) as Record<string, any>;
const inline = import.meta.glob("/assets/figures/*/atlas.png", { eager: true, query: "?inline", import: "default" }) as Record<string, string>;

const ordner = (art: string) => `/assets/${art}/${STYLE}/`;
const vorhanden = (art: string, f: string) => alle.includes(ordner(art) + f);
function atlasHoehe(): number | null {
  const url = inline[ordner("figures") + "atlas.png"];
  if (!url) return null;
  const bin = atob(url.slice(url.indexOf(",") + 1, url.indexOf(",") + 1 + 64));
  return pngHeight(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

describe("Sprite-Dateien im Build", () => {
  it("Figuren: der Lader findet alles, was er für den Atlas oder die Einzelbilder braucht", () => {
    const meta = blaetter[ordner("figures") + "sheet.json"] as FigureFilesMeta;
    expect(meta.units.length).toBeGreaterThan(0);
    const fehlt = figureFiles(meta, atlasHoehe()).filter((f) => !vorhanden("figures", f));
    expect(fehlt).toEqual([]);
  });

  it("Figuren: ein Atlas, der nicht alle Einheiten enthält, lässt die Einzelbilder im Build", () => {
    const meta: FigureFilesMeta = { cell: 10, units: [{ key: "a" }, { key: "b" }] };
    expect(figureRows(meta)).toBe(16);
    expect(atlasCovers(meta, 159)).toBe(false);
    expect(figureFiles(meta, 159)).toEqual(["sheet.json", "a.png", "b.png"]);
    expect(figureFiles(meta, null)).toEqual(["sheet.json", "a.png", "b.png"]);
    expect(figureFiles(meta, 160)).toEqual(["sheet.json", "atlas.png"]);
  });

  it("Figuren: die Atlashöhe kommt aus dem PNG-Kopf", () => {
    if (!vorhanden("figures", "atlas.png")) return; // ohne Atlas gelten die Einzelbilder (oben geprüft)
    const h = atlasHoehe();
    expect(h).not.toBeNull();
    expect(h).toBeGreaterThan(0);
    const meta = blaetter[ordner("figures") + "sheet.json"] as FigureFilesMeta;
    // Deckt der Atlas nicht alle Einheiten, muss jedes Einzelbild im Build bleiben
    if (!atlasCovers(meta, h)) expect(figureFiles(meta, h)).toHaveLength(meta.units.length + 1);
  });

  it("Gelände: Hauptbild, Bilder angehängter Arten und Übergangsmasken sind da", () => {
    const meta = blaetter[ordner("terrain") + "sheet.json"];
    const bilder = terrainImages(meta);
    for (const k of Object.values(meta.keys) as { image?: string }[]) expect(bilder).toContain(k.image ?? (meta.image || "terrain.png"));
    expect(terrainFiles(meta).filter((f) => !vorhanden("terrain", f))).toEqual([]);
  });

  it("Gebäude: jedes Blatt und jede Vorderansicht sind da", () => {
    const meta = blaetter[ordner("buildings") + "sheet.json"];
    expect(buildingFiles(meta).filter((f) => !vorhanden("buildings", f))).toEqual([]);
  });

  it("pngHeight erkennt nur PNG", () => {
    expect(pngHeight(new Uint8Array(30))).toBeNull();
    const kopf = new Uint8Array(24);
    kopf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    kopf.set([0, 0, 0x1f, 0x68], 20);
    expect(pngHeight(kopf)).toBe(8040);
  });
});
