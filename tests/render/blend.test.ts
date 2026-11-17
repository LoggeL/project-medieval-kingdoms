import { describe, expect, it } from "vitest";
import type { TerrainKey } from "../../src/data";
import { EDGES, EDGE_NEIGHBOUR, blendPlan, maskTile, maskVariant, precedence } from "../../src/render/blend";
import { viewToScreen } from "../../src/render/iso";

/** Kleine Karte in Ansichtskoordinaten aus Zeilen (v) mit Buchstaben je u. */
function grid(rows: string[]): (u: number, v: number) => TerrainKey | null {
  const map: Record<string, TerrainKey> = { g: "gras", w: "wiese", f: "waldboden", e: "erde", s: "fels", a: "wasser" };
  return (u, v) => (v < 0 || v >= rows.length || u < 0 || u >= rows[v].length ? null : map[rows[v][u]]);
}

/**
 * Testmaske, nur hier im Test erzeugt (die echte kommt als blend.png von der Grafik): 64 × 32, deckend in der Hälfte
 * der Raute an der Kante ne, sonst durchsichtig.
 */
function testMask(): Uint8ClampedArray {
  const m = new Uint8ClampedArray(64 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
    const i = (y * 64 + x) * 4;
    m[i] = m[i + 1] = m[i + 2] = 255;
    // Abstand zur Kante oben → rechts (Linie von (32, 0) nach (64, 16))
    const d = (y - (x - 32) / 2);
    m[i + 3] = d < 6 ? 255 : 0;
  }
  return m;
}

describe("Geländeübergänge", () => {
  it("Kanten zeigen auf den Nachbarn jenseits der Bildschirmkante", () => {
    const [cx, cy] = viewToScreen(10.5, 10.5);
    for (const e of EDGES) {
      const [du, dv] = EDGE_NEIGHBOUR[e];
      const [nx, ny] = viewToScreen(10.5 + du, 10.5 + dv);
      const right = nx > cx, down = ny > cy;
      expect(e).toBe(`${down ? "s" : "n"}${right ? "e" : "w"}`);
    }
  });

  it("legt nur Nachbarn mit höherem Vorrang über die Kachel, niedriger zuerst", () => {
    // Mitte (1, 1) ist Erde, oben Gras, rechts Wiese, unten Fels, links Erde
    const at = grid(["ggg", "eew", "sss"]);
    const plan = blendPlan(at, 1, 1);
    expect(plan.map((p) => p.terrain)).toEqual(["fels", "gras", "wiese"]);
    expect(plan.map((p) => p.edge)).toEqual(["sw", "ne", "se"]);
    expect(plan.every((p) => !p.shore)).toBe(true);
    expect(precedence("wiese")).toBeGreaterThan(precedence("wasser"));
  });

  it("Wasser überdeckt nie Land, Land über Wasser ist Ufer", () => {
    const at = grid(["aaa", "aga", "aaa"]);
    expect(blendPlan(at, 1, 1)).toEqual([]);
    const shore = blendPlan(at, 1, 0);
    expect(shore).toEqual([{ edge: "sw", terrain: "gras", shore: true }]);
  });

  it("gleiche Nachbarn und Kartenrand ergeben keinen Übergang", () => {
    const at = grid(["gg", "gg"]);
    for (let v = 0; v < 2; v++) for (let u = 0; u < 2; u++) expect(blendPlan(at, u, v)).toEqual([]);
  });

  it("maskiert hart (Pixelart, keine Halbtransparenz)", () => {
    const tile = new Uint8ClampedArray(64 * 32 * 4);
    for (let i = 0; i < tile.length; i += 4) { tile[i] = 90; tile[i + 1] = 140; tile[i + 2] = 60; tile[i + 3] = 255; }
    const out = maskTile(tile, testMask());
    const alphas = new Set<number>();
    for (let i = 3; i < out.length; i += 4) alphas.add(out[i]);
    expect([...alphas].sort()).toEqual([0, 255]);
    // oben rechts deckend, unten links durchsichtig
    expect(out[(4 * 64 + 50) * 4 + 3]).toBe(255);
    expect(out[(28 * 64 + 10) * 4 + 3]).toBe(0);
    expect(out[(4 * 64 + 50) * 4 + 1]).toBe(140);
  });

  it("Maskenvariante ist stabil und verteilt", () => {
    expect(maskVariant(5, 7, "ne", 4)).toBe(maskVariant(5, 7, "ne", 4));
    const seen = new Set<number>();
    for (let x = 0; x < 20; x++) seen.add(maskVariant(x, 3, "se", 4));
    expect(seen.size).toBeGreaterThan(1);
    expect(maskVariant(1, 2, "sw", 1)).toBe(0);
  });
});
