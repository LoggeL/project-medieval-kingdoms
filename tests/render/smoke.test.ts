import { describe, expect, it } from "vitest";
import { CHIMNEYS, LIFE, PUFFS, chimneyWorld, puffs } from "../../src/render/smoke";
import { ObjectLayer } from "../../src/render/scene";
import { worldToScreen } from "../../src/render/iso";
import { createGame } from "../../src/sim";
import { buildNow } from "../../src/sim/debug";
import { viewOf, type Rot } from "../../src/sim/geom";
import { fakeBuildingSheet, fakeFigureSheet } from "./fakes";

/**
 * Schornsteinöffnung im Sprite relativ zum Anker (144, 184), je Ansicht 0..3. Aus den Bildern ermittelt:
 * an diesen Punkten ist das Sprite deckend, darüber liegt die Oberkante des Schornsteins (assets/buildings/vorgerendert).
 */
const SPRITE: Record<string, [number, number][]> = {
  haus: [[19.5, -79.5], [6.3, -92.4], [-19.5, -85.8], [-6.3, -72.9]],
  kaserne: [[4.6, -129.1], [-54.9, -103.9], [-4.6, -74.2], [54.9, -99.3]],
  // Oberkante des Schornsteins im Bild je Ansicht −72, −107, −94, −59 (wie beim Wohnhaus gut 3 px über der Öffnung)
  baeckerei: [[47.8, -68.6], [21.4, -103.2], [-47.8, -90.0], [-21.4, -55.4]],
};

describe("Schornsteinrauch", () => {
  it("sitzt in jeder Ausrichtung und Kameradrehung auf dem Schornstein der gezeigten Sprite-Ansicht", () => {
    const W = 64, H = 64;
    for (const key of Object.keys(CHIMNEYS)) for (let o = 0; o < 4; o++) for (const r of [0, 1, 2, 3] as Rot[]) {
      const cx = 20, cy = 20;
      const [wx, wy, z] = chimneyWorld(CHIMNEYS[key][0], o);
      const [X0, Y0] = worldToScreen(cx, cy, 0, r, W, H);
      const [X, Y] = worldToScreen(cx + wx, cy + wy, z, r, W, H);
      const [ex, ey] = SPRITE[key][viewOf(o, r)];
      expect(Math.abs(X - X0 - ex)).toBeLessThan(0.6);
      expect(Math.abs(Y - Y0 - ey)).toBeLessThan(0.6);
    }
  });

  it("ist eine reine Funktion der Zeit: gleiche Zeit, gleiches Bild; Wölkchen steigen und blenden aus", () => {
    const a = puffs(100, 50, 12.3, 0, 7).map((q) => ({ ...q }));
    const b = puffs(100, 50, 12.3, 0, 7).map((q) => ({ ...q }));
    expect(a).toEqual(b);
    expect(a.length).toBe(PUFFS);
    const c = puffs(100, 50, 12.3 + 0.5, 0, 7);
    expect(c.some((q, i) => q.y !== a[i].y)).toBe(true);
    for (let t = 0; t < LIFE; t += 0.1) for (const q of puffs(100, 50, t, 1, 3)) {
      expect(q.y).toBeLessThanOrEqual(50 + 3);
      expect(q.y).toBeGreaterThanOrEqual(50 - 50);
      expect(q.alpha).toBeGreaterThanOrEqual(0);
      expect(q.alpha).toBeLessThanOrEqual(0.8);
    }
  });

  it("nur fertige, sichtbare Häuser und Kasernen rauchen", () => {
    const g = createGame({ seed: 1 });
    const h = buildNow(g, "haus", 20, 40, 1);
    const layer = new ObjectLayer(fakeBuildingSheet(), fakeFigureSheet());
    const opt = { selectedUnits: new Set<number>(), danger: null, highlight: null, ghosts: [] };
    layer.update(g.state, 2, 1, { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 }, opt);
    expect(layer.emitters.length).toBe(1);
    expect(layer.emitters[0].seed).toBe(h.id * 7);
    layer.update(g.state, 2, 1, { x0: 0, y0: 0, x1: 1, y1: 1 }, opt); // außerhalb des Bildes
    expect(layer.emitters.length).toBe(0);
    h.built = 0.5;
    layer.update(g.state, 2, 1, { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 }, opt);
    expect(layer.emitters.length).toBe(0);
  });
});
