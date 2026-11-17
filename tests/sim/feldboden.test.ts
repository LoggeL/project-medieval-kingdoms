/**
 * Zusammenführung Landschaft (ADR 0012) und Landwirtschaft (ADR 0013): EINE Feldregel. Wo ein Beet liegen darf, sagt
 * FieldDef.terrain des Hofs; wie schnell eine Ackerfrucht (CropDef.boden) dort reift, sagt FELD_BODEN (fruchtbar 1,
 * Wiese 0,7). Getreide wächst auf fruchtbarem Boden schneller als auf Wiese, Apfelbäume überall gleich.
 */
import { describe, expect, it } from "vitest";
import { BUILDINGS, CROPS, FELD_BODEN, fruchtbarkeit, type TerrainKey } from "../../src/data";
import { createGame, loadGame } from "../../src/sim";
import { buildNow, stockUp, worldOf } from "../../src/sim/debug";
import { fieldRect, plotGrowth, soilCounts } from "../../src/sim/farm";
import type { Simulation } from "../../src/sim/game";
import { TPS } from "../../src/sim/world";

function field(terrain: TerrainKey): Simulation {
  const g = createGame({ seed: 3, size: 40, scenario: "leer" });
  for (const t of g.state.tiles) t.terrain = terrain;
  buildNow(g, "kornkammer", 4, 4);
  buildNow(g, "lager", 4, 10);
  stockUp(g, "holz", 60);
  return g;
}

/** Ticks, bis das erste Beet von „gesät“ (Stufe 2) bis „reif“ gewachsen ist, ohne Bauer (nur Wachstum). */
function growTicks(terrain: TerrainKey): number {
  const g = field(terrain);
  const b = buildNow(g, "bauernhof", 16, 16, 0);
  for (const id of [...b.workers]) worldOf(g).units.delete(id);
  b.workers.length = 0;
  for (const p of b.farm!.plots) { p.stage = 2; p.t = 0; }
  const ripe = CROPS.getreide.stages.findIndex((s) => s.harvest);
  let n = 0;
  while (b.farm!.plots[0].stage < ripe && n < 10_000) { g.tick(); n++; }
  return n;
}

describe("Feldregel: Gelände der Höfe und Ackerboden", () => {
  it("Daten: jeder Boden einer Ackerfrucht hat einen Ertragsfaktor > 0, fruchtbarer Boden ist überall erlaubt", () => {
    for (const def of Object.values(BUILDINGS)) {
      const f = def.fields;
      if (!f) continue;
      expect(f.terrain).toContain("fruchtbar");
      if (CROPS[f.crop].boden) for (const t of f.terrain) expect(fruchtbarkeit(t), `${def.name}: ${t}`).toBeGreaterThan(0);
    }
    expect(FELD_BODEN.fruchtbar).toBe(1);
  });

  it("ein Getreidehof lässt sich auf reinem fruchtbarem Boden setzen, mit allen Beeten", () => {
    for (const o of [0, 1, 2, 3]) {
      const g = field("fruchtbar");
      const chk = g.canPlace("bauernhof", 16, 16, o);
      expect(chk.ok, `o=${o}`).toBe(true);
      const b = buildNow(g, "bauernhof", 16, 16, o);
      expect(b.farm!.plots.length, `o=${o}`).toBe(fieldRect("bauernhof", 16, 16, o).length);
      expect(soilCounts(g.state, b.farm!), `o=${o}`).toEqual({ fruchtbar: b.farm!.plots.length });
    }
  });

  it("Getreide reift auf fruchtbarem Boden schneller als auf Wiese (Faktor aus FELD_BODEN), Wiese wie vor der Zusammenführung", () => {
    const fr = growTicks("fruchtbar"), wi = growTicks("wiese");
    const base = CROPS.getreide.stages.reduce((n, s) => n + (s.grow ?? 0), 0);
    expect(Math.abs(fr - base * TPS)).toBeLessThanOrEqual(3);
    expect(Math.abs(wi - (base / fruchtbarkeit("wiese")) * TPS)).toBeLessThanOrEqual(3);
    // Wiese: 20 + 25 + 25 s wie im Zweig nahrung
    expect(Math.abs(wi - 70 * TPS)).toBeLessThanOrEqual(3);
    expect(fr).toBeLessThan(wi);
  });

  it("Apfelbäume wachsen auf jedem erlaubten Boden gleich schnell", () => {
    expect(CROPS.apfel.boden).toBeFalsy();
    for (const t of ["fruchtbar", "gras", "wiese"] as TerrainKey[]) {
      const g = field(t);
      const b = buildNow(g, "obstgarten", 16, 16, 0);
      expect(b.farm!.plots.length, t).toBeGreaterThanOrEqual(BUILDINGS.obstgarten.fields!.min);
      expect(plotGrowth(g.state, b.farm!, b.farm!.plots[0]), t).toBe(1);
    }
  });

  it("Mischboden: jedes Beet wächst nach seinem eigenen Boden, auch nach Speichern und Laden", () => {
    const g = field("wiese");
    const rect = fieldRect("bauernhof", 16, 16, 0);
    for (const [x, y] of rect.slice(0, 4)) g.state.tiles[y * 40 + x].terrain = "fruchtbar";
    const b = buildNow(g, "bauernhof", 16, 16, 0);
    expect(soilCounts(g.state, b.farm!)).toEqual({ fruchtbar: 4, wiese: rect.length - 4 });
    const g2 = loadGame(g.save());
    const b2 = g2.state.buildings.find((q) => q.id === b.id)!;
    const rates = b2.farm!.plots.map((p) => plotGrowth(g2.state, b2.farm!, p));
    expect(rates.filter((r) => r === 1)).toHaveLength(4);
    expect(rates.filter((r) => r === fruchtbarkeit("wiese"))).toHaveLength(rect.length - 4);
  });
});
