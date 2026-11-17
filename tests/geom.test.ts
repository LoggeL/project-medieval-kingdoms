import { describe, expect, it } from "vitest";
import { BUILDINGS, type BuildingKey } from "../src/data";
import { approach, doorInside, entrance, footprint, footprintTiles, modelToWorld, shelfWorld, stairEnds, storeWalk, turn, viewOf } from "../src/sim/geom";

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
    expect(entrance("kaserne", 10, 10, 0)).toEqual([12, 13]); // Vorderseite Modell −y = Welt +y
    expect(approach("kaserne", 10, 10, 0)).toEqual([12, 13]);
    // Lagerhaus: Tür (Daten door [0, −2]) vor dem Tor, außerhalb des Grundrisses; der Vorplatz ist die Tür selbst
    expect(entrance("lager", 10, 10, 0)).toEqual([11, 13]);
    expect(approach("lager", 10, 10, 0)).toEqual([11, 13]);
    expect(doorInside("lager", 10, 10, 0)).toBe(false);
    expect(doorInside("haus", 10, 10, 0)).toBe(false);
    expect(doorInside("bergfried", 10, 10, 0)).toBe(false);
  });
  it("Tür aller Gebäude mit Tür liegt vor dem Grundriss, an der Vorderseite, kein Fach darauf (alle Ausrichtungen)", () => {
    for (const key of Object.keys(BUILDINGS) as BuildingKey[]) {
      if (!BUILDINGS[key].door) continue;
      for (let o = 0; o < 4; o++) {
        const door = entrance(key, 10, 10, o);
        expect(doorInside(key, 10, 10, o), `${key} o ${o}`).toBe(false);
        expect(approach(key, 10, 10, o)).toEqual(door);
        // direkt an der Vorderkante: der Tile dahinter (Modell +y) gehört zum Grundriss
        const [bx, by] = modelToWorld(0, 1, o);
        const fp = new Set(footprintTiles(key, 10, 10, o).map(([x, y]) => `${x},${y}`));
        expect(fp.has(`${door[0] + bx},${door[1] + by}`), `${key} o ${o}`).toBe(true);
      }
    }
    for (let o = 0; o < 4; o++) {
      const door = entrance("lager", 10, 10, o);
      for (let k = 0; k < 8; k++) {
        const [x, y] = shelfWorld("lager", 10, 10, o, k);
        expect([Math.floor(x), Math.floor(y)]).not.toEqual(door);
      }
    }
  });
  it("offene Einfahrt im Grundriss: Vorplatz liegt davor und dreht mit", () => {
    // Kein Gebäude der Daten hat zurzeit eine Einfahrt; das Türmodell kann sie (ADR 0010), hier mit einer Testtür
    const old = BUILDINGS.lager.door;
    BUILDINGS.lager.door = [0, -1];
    try {
      expect(entrance("lager", 10, 10, 0)).toEqual([11, 12]);
      expect(approach("lager", 10, 10, 0)).toEqual([11, 13]);
      for (let o = 0; o < 4; o++) {
        const door = entrance("lager", 10, 10, o);
        expect(doorInside("lager", 10, 10, o)).toBe(true);
        const [ax, ay] = approach("lager", 10, 10, o), [fx, fy] = modelToWorld(0, -1, o);
        expect([ax - door[0], ay - door[1]]).toEqual([fx + 0, fy + 0]);
      }
    } finally { BUILDINGS.lager.door = old; }
  });
  it("Zugangskachel aus den Daten dreht mit der Ausrichtung", () => {
    // Lagerhaus 3 × 3 bei (10, 10): Zugang Modell (0, −2) = Welt vor der Vorderkante, je Ausrichtung eine andere Seite
    expect(entrance("lager", 10, 10, 0)).toEqual([11, 13]);
    expect(entrance("lager", 10, 10, 1)).toEqual([13, 11]);
    expect(entrance("lager", 10, 10, 2)).toEqual([11, 9]);
    expect(entrance("lager", 10, 10, 3)).toEqual([9, 11]);
  });
  it("Fächer liegen im Grundriss, der Weg dorthin beginnt vor dem Tor und bleibt danach im Gebäude", () => {
    for (let o = 0; o < 4; o++) {
      const fp = new Set(footprintTiles("lager", 10, 10, o).map(([x, y]) => `${x},${y}`));
      const [ex, ey] = entrance("lager", 10, 10, o);
      expect(fp.has(`${ex},${ey}`)).toBe(false);
      for (let k = 0; k < 8; k++) {
        const [x, y] = shelfWorld("lager", 10, 10, o, k);
        expect(fp.has(`${Math.floor(x)},${Math.floor(y)}`)).toBe(true);
        const walk = storeWalk("lager", 10, 10, o, k);
        expect(walk[0]).toEqual([ex + 0.5, ey + 0.5]);
        for (const [px, py] of walk.slice(1)) expect(fp.has(`${Math.floor(px)},${Math.floor(py)}`)).toBe(true);
        // Standpunkt vor dem Fach, nicht darauf
        const [sx, sy] = walk[walk.length - 1];
        expect(Math.hypot(sx - x, sy - y)).toBeGreaterThan(0.4);
      }
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
