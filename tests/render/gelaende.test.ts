/**
 * Darstellung der Landschaft (ADR 0012): Massivteile je Gebirgs-Tile in jeder Drehung, Geländeblatt und Übergänge
 * kennen jede Geländeart, die neuen Kacheln liegen in einem eigenen Bild (terrain.png bleibt unverändert).
 */
import { describe, expect, it } from "vitest";
import { TERRAIN, type TerrainKey } from "../../src/data";
import { BLEND_ORDER } from "../../src/render/blend";
import { ObjectLayer, mountainPieces } from "../../src/render/scene";
import { createGame } from "../../src/sim";
import { spawn } from "../../src/sim/debug";
import { mountainClass } from "../../src/sim/mapgen";
import BMETA from "../../assets/buildings/vorgerendert/sheet.json";
import TMETA from "../../assets/terrain/vorgerendert/sheet.json";
import { fakeBuildingSheet, fakeFigureSheet } from "./fakes";

const ALL = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
const opt = () => ({ selectedUnits: new Set<number>(), danger: null, highlight: null, ghosts: [] });
const NEU: TerrainKey[] = ["huegel", "gebirge", "sumpf", "sand", "fruchtbar"];

describe("Gebirge in der Darstellung", () => {
  it("ein Massivteil je Gebirgs-Tile, in allen vier Drehungen, Höhenklasse aus mountainClass", () => {
    const g = createGame({ seed: 1, raids: false });
    const s = g.state;
    const n = s.tiles.filter((t) => t.terrain === "gebirge").length;
    expect(n).toBeGreaterThan(50);
    const pieces = mountainPieces(s);
    expect(pieces).toHaveLength(n);
    expect(mountainPieces(s)).toBe(pieces); // gecacht
    for (const p of pieces) {
      expect(Math.floor(p.frame / 4)).toBe(mountainClass(s.tiles, s.w, s.h, p.x, p.y));
      expect(p.frame).toBeLessThan(12);
    }
    expect(new Set(pieces.map((p) => Math.floor(p.frame / 4))).size).toBe(3); // Rand, Hang und Gipfel kommen vor
    const layer = new ObjectLayer(fakeBuildingSheet(), fakeFigureSheet());
    const bare = new ObjectLayer(fakeBuildingSheet({ without: ["gebirge"] }), fakeFigureSheet());
    for (const r of [0, 1, 2, 3] as const) {
      layer.update(s, r, 1, ALL, opt());
      bare.update(s, r, 1, ALL, opt());
      expect(layer.stats.items - bare.stats.items, `Drehung ${r}`).toBe(n);
    }
  });

  it("Massivteile verdecken Figuren dahinter (Silhouette), auch mit den auf den Inhalt beschnittenen Texturen", () => {
    // Inhalt der Zelle nur im Rahmen der Ersatz-bbox (100..220, 40..200): ein falscher Versatz träfe ins Leere
    const alpha = (key: string, x: number, y: number) => (key !== "gebirge" || (x >= 100 && x < 220 && y >= 40 && y < 200) ? 255 : 0);
    const g = createGame({ scenario: "leer", size: 24, seed: 2 });
    g.state.tiles[10 * 24 + 10].terrain = "gebirge";
    const u = spawn(g, "speer", 0, 9, 9);
    const layer = new ObjectLayer(fakeBuildingSheet({ alpha }), fakeFigureSheet());
    layer.update(g.state, 0, 1, ALL, opt());
    expect(layer.stats.silhouettes).toBe(1);
    // vor dem Berg: keine Silhouette
    u.x = u.px = 11.5; u.y = u.py = 11.5;
    layer.update(g.state, 0, 1, ALL, opt());
    expect(layer.stats.silhouettes).toBe(0);
  });

  it("nur sichtbare Teile werden gezeichnet, und ohne Sprite bleibt es beim Geröllboden (kein Ersatzbild)", () => {
    const g = createGame({ seed: 1, raids: false });
    const sheet = fakeBuildingSheet();
    const layer = new ObjectLayer(sheet, fakeFigureSheet());
    layer.update(g.state, 0, 1, ALL, opt());
    const all = layer.stats.items;
    // Ausschnitt im Südosten, weit weg vom Massiv im Nordwesten
    layer.update(g.state, 0, 1, { x0: 600, y0: 1400, x1: 1400, y1: 1900 }, opt());
    expect(layer.stats.items).toBeLessThan(all);
    const without = fakeBuildingSheet({ without: ["gebirge"] });
    const l2 = new ObjectLayer(without, fakeFigureSheet());
    expect(() => l2.update(g.state, 2, 1, ALL, opt())).not.toThrow();
    expect(without.calls.some((c) => c.startsWith("gebirge"))).toBe(false);
  });

  it("Gebäudeblatt hat das Massiv mit 12 Bildern (3 Höhenklassen × 4 Varianten)", () => {
    const u = (BMETA as unknown as { units: { key: string; frames: number; footprint: number[] }[] }).units.find((x) => x.key === "gebirge");
    expect(u).toBeDefined();
    expect(u!.frames).toBe(12);
    expect(u!.footprint).toEqual([1, 1]);
  });
});

describe("Geländeblatt und Übergänge", () => {
  const meta = TMETA as unknown as { image: string; keys: Record<string, { row: number; variants: number; frames: number; image?: string }>; images?: Record<string, unknown> };

  it("jede Geländeart hat Kacheln; die neuen liegen in gelaende.png, die alten unverändert in terrain.png", () => {
    for (const k of Object.keys(TERRAIN)) expect(meta.keys[k], k).toBeDefined();
    for (const k of NEU) {
      if (k === "sumpf") continue; // Sumpf gab es im Blatt schon (Zeile in terrain.png)
      expect(meta.keys[k].image).toBe("gelaende.png");
      expect(meta.keys[k].variants).toBe(4);
    }
    expect(meta.image).toBe("terrain.png");
    expect(meta.images?.["gelaende.png"]).toBeDefined();
    const rows = NEU.filter((k) => meta.keys[k].image === "gelaende.png").map((k) => meta.keys[k].row);
    expect(new Set(rows).size).toBe(rows.length);
  });

  it("Übergänge: jede Geländeart hat einen Vorrang, Wasser ganz unten", () => {
    for (const k of Object.keys(TERRAIN)) expect(BLEND_ORDER, k).toContain(k);
    expect(BLEND_ORDER[0]).toBe("wasser");
    expect(new Set(BLEND_ORDER).size).toBe(BLEND_ORDER.length);
  });
});
