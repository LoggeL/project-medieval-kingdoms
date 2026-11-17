import { describe, expect, it } from "vitest";
import { toView, type Rot } from "../../src/sim/geom";
import { figureDir, fromView, mapScreenBounds, screenToWorld, vecToScreen, worldToScreen } from "../../src/render/iso";

const W = 48, H = 40;
const ROTS: Rot[] = [0, 1, 2, 3];

describe("Iso-Projektion", () => {
  it("fromView kehrt toView in allen Drehungen um", () => {
    for (const r of ROTS) for (const [x, y] of [[0, 0], [3.25, 7.5], [47, 39], [12, 0.5]]) {
      const [u, v] = toView(x, y, r, W, H);
      const [bx, by] = fromView(u, v, r, W, H);
      expect(bx).toBeCloseTo(x); expect(by).toBeCloseTo(y);
    }
  });

  it("Mausauswahl trifft den richtigen Tile in allen Drehungen, auch auf Höhe", () => {
    for (const r of ROTS) for (const z of [0, 3, 5]) for (const [tx, ty] of [[5, 9], [30, 2], [0, 39], [47, 0]]) {
      const [X, Y] = worldToScreen(tx + 0.5, ty + 0.5, z, r, W, H);
      // ein paar Pixel neben der Tile-Mitte
      for (const [dx, dy] of [[0, 0], [10, 3], [-12, -4], [0, 7]]) {
        const [wx, wy] = screenToWorld(X + dx, Y + dy, z, r, W, H);
        expect([Math.floor(wx), Math.floor(wy)]).toEqual([tx, ty]);
      }
    }
  });

  it("Drehung 0: x nach rechts unten, y nach links unten", () => {
    const [ax, ay] = vecToScreen(1, 0, 0), [bx, by] = vecToScreen(0, 1, 0);
    expect(ax).toBeGreaterThan(0); expect(ay).toBeGreaterThan(0);
    expect(bx).toBeLessThan(0); expect(by).toBeGreaterThan(0);
  });

  it("Bildrichtung der Figur folgt der Kameradrehung", () => {
    // Blick nach Welt +x+y zeigt bei r = 0 nach Süden (Zeile 0), nach jeder Drehung um 2 Zeilen weiter
    expect(figureDir(1, 1, 0)).toBe(0);
    expect(figureDir(1, 0, 0)).toBe(1); // nach rechts unten = SO
    for (const r of ROTS) for (const [fx, fy] of [[1, 0], [0, -1], [-1, 1], [1, 1], [-1, -1]]) {
      // Konzept Kapitel 09 §4: angezeigt wird (d − 2r) mod 8 (für Achsen und Diagonalen exakt)
      const d0 = figureDir(fx, fy, 0);
      const d = figureDir(fx, fy, r);
      expect(d).toBe((((d0 - 2 * r) % 8) + 8) % 8);
    }
  });

  it("Kartengrenzen tauschen Breite und Höhe bei ungerader Drehung", () => {
    const a = mapScreenBounds(0, W, H), b = mapScreenBounds(1, W, H);
    expect(a.x1).toBe(W * 32); expect(a.x0).toBe(-H * 32);
    expect(b.x1).toBe(H * 32); expect(b.x0).toBe(-W * 32);
  });
});
