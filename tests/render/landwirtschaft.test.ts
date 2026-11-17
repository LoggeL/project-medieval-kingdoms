/**
 * Darstellung der Landwirtschaft (ADR 0013): jedes Beet zeigt die Bildvariante seiner Stufe, Getreide dreht mit dem Hof
 * in allen vier Kameradrehungen, ein Klick auf ein Beet trifft den Hof; der Bauer wechselt die Figur je Arbeit
 * (Hacke, Saat) und trägt die Garbe als eigene Figur.
 */
import { describe, expect, it } from "vitest";
import { CROPS } from "../../src/data";
import { ObjectLayer } from "../../src/render/scene";
import { createGame } from "../../src/sim";
import { buildNow, spawn } from "../../src/sim/debug";
import { viewOf, type Rot } from "../../src/sim/geom";
import { fakeBuildingSheet, fakeFigureSheet } from "./fakes";

const ALL = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
const opt = () => ({ selectedUnits: new Set<number>(), danger: null, highlight: null, ghosts: [] });

function meadow() {
  const g = createGame({ scenario: "leer", size: 32, seed: 4 });
  for (const t of g.state.tiles) t.terrain = "wiese";
  return g;
}

describe("Landwirtschaft in der Darstellung", () => {
  it("jedes Beet zeigt die Variante seiner Stufe, Getreide liegt in jeder Drehung längs des Hofs", () => {
    for (const o of [0, 1, 2, 3]) {
      const g = meadow();
      const farm = buildNow(g, "bauernhof", 12, 12, o);
      const plots = farm.farm!.plots;
      expect(plots.length).toBeGreaterThanOrEqual(6);
      plots.forEach((p, i) => { p.stage = i % CROPS.getreide.stages.length; });
      const layer = new ObjectLayer(fakeBuildingSheet(), fakeFigureSheet());
      for (const r of [0, 1, 2, 3] as Rot[]) {
        layer.update(g.state, r, 1, ALL, opt());
        const hits = layer.hits.filter((h) => h.kind === "building" && h.id === farm.id && h.key === "acker");
        expect(hits).toHaveLength(plots.length);
        for (const h of hits) expect(h.view).toBe(viewOf(o, r));
        expect(new Set(hits.map((h) => h.frame))).toEqual(new Set(plots.map((p) => CROPS.getreide.stages[p.stage].frame)));
      }
    }
  });

  it("Apfelbäume stehen als Bäume auf den Beeten, reife tragen Früchte", () => {
    const g = meadow();
    const orchard = buildNow(g, "obstgarten", 12, 12, 0);
    const plots = orchard.farm!.plots;
    plots[0].stage = 3;
    const layer = new ObjectLayer(fakeBuildingSheet(), fakeFigureSheet());
    layer.update(g.state, 0, 1, ALL, opt());
    const hits = layer.hits.filter((h) => h.id === orchard.id && h.key === "apfelbaum");
    expect(hits).toHaveLength(plots.length);
    expect(hits.some((h) => h.frame === 3)).toBe(true);
  });

  it("der Bauer hat je Arbeit eine eigene Figur und trägt die Garbe selbst", () => {
    const g = meadow();
    const u = spawn(g, "bauer", 0, 5, 5);
    const layer = new ObjectLayer(fakeBuildingSheet(), fakeFigureSheet());
    const key = () => { layer.update(g.state, 0, 1, ALL, opt()); return layer.hits.find((h) => h.kind === "unit" && h.id === u.id)!.key; };
    u.anim = "pfluegen"; expect(key()).toBe("bauer_hacke");
    u.anim = "saeen"; expect(key()).toBe("bauer_saat");
    u.anim = "ernten"; expect(key()).toBe("bauer");
    u.anim = "gehen"; u.carry = "getreide"; expect(key()).toBe("bauer_garbe");
    const o = spawn(g, "obstbauer", 0, 7, 5);
    o.anim = "gehen"; o.carry = "apfel";
    layer.update(g.state, 0, 1, ALL, opt());
    expect(layer.hits.find((h) => h.kind === "unit" && h.id === o.id)!.key).toBe("obstbauer");
    const t = spawn(g, "tageloehner", 0, 9, 5);
    t.anim = "gehen"; t.carry = "apfel";
    layer.update(g.state, 0, 1, ALL, opt());
    expect(layer.hits.find((h) => h.kind === "unit" && h.id === t.id)!.key).toBe("traeger_apfel");
  });
});
