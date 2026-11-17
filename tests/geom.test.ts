import { describe, expect, it } from "vitest";
import { entrance, footprint, modelToWorld, slotTile, stairEnds, turn, viewOf } from "../src/sim/geom";

describe("geom", () => {
  it("dreht Versätze im Sinn der Gebäudeansichten", () => {
    expect(turn(1, 0, 1)).toEqual([0, -1]);
    expect(turn(1, 0, 4)).toEqual([1, 0]);
    expect(modelToWorld(0, 1, 0)).toEqual([0, -1]); // Modell +y zeigt nach hinten (Welt −y)
  });
  it("tauscht den Grundriss bei ungerader Ausrichtung", () => {
    expect(footprint("kaserne", 0)).toEqual([4, 3]);
    expect(footprint("kaserne", 1)).toEqual([3, 4]);
  });
  it("legt den Eingang vor die Vorderseite", () => {
    expect(entrance("lager", 10, 10, 0)).toEqual([11, 13]); // Vorderseite Modell −y = Welt +y
  });
  it("Lager-Slots liegen im Grundriss", () => {
    for (let k = 0; k < 8; k++) for (let o = 0; o < 4; o++) {
      const [x, y] = slotTile(10, 10, o, k);
      expect(x).toBeGreaterThanOrEqual(10); expect(x).toBeLessThan(13);
      expect(y).toBeGreaterThanOrEqual(10); expect(y).toBeLessThan(13);
    }
  });
  it("Treppe: oben an der Mauer, unten am Boden", () => {
    const e = stairEnds(5, 5, 0); // 1 × 2: Tiles (5,5) und (5,6)
    expect(e.top).toEqual([5, 5]); expect(e.bottom).toEqual([5, 6]); expect(e.wall).toEqual([5, 4]);
  });
  it("Ansicht = (o − r) mod 4", () => { expect(viewOf(0, 1)).toBe(3); expect(viewOf(2, 1)).toBe(1); });
});

import { wallPiece } from "../src/sim/geom";
describe("wallPiece", () => {
  it("findet für jede Maske ein Teil", () => {
    for (let m = 0; m < 16; m++) expect(wallPiece(m).piece).toBeTruthy();
    expect(wallPiece(0b1010)).toEqual({ piece: "mauer_gerade", o: 0 });
    expect(wallPiece(0b0101).piece).toBe("mauer_gerade");
    expect(wallPiece(0b0001).piece).toBe("mauer_ende");
    expect(wallPiece(0b1111).piece).toBe("mauer_kreuz");
  });
});
