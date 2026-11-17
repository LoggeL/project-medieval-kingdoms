/**
 * Zusammenführung „lebendige Welt“ (ADR 0016) mit Wegen und Brücken (ADR 0015), Feldern (ADR 0013) und Landschaft
 * (ADR 0012): Tiere laufen über Wege und fertige Brücken wie die Figuren im Laufraster, der Wald wächst nicht auf Beeten
 * nach, nachwachsende Bäume sperren ein Feld so wenig wie ein Gebäude, Krähen landen auch auf fruchtbarem Boden.
 */
import { describe, expect, it } from "vitest";
import { ANIMALS, BUILDINGS, LIFE } from "../../src/data";
import { createGame } from "../../src/sim";
import { passable, spawnGroup } from "../../src/sim/animals";
import { buildNow, run, stockUp, worldOf } from "../../src/sim/debug";
import { fieldRect } from "../../src/sim/farm";
import type { Tree } from "../../src/sim/types";
import { TPS } from "../../src/sim/world";

function leer(size = 40) {
  const g = createGame({ scenario: "leer", size, seed: 7, raids: false });
  const w = worldOf(g);
  for (const t of w.s.tiles) t.terrain = "wiese";
  return { g, w };
}

const tree = (id: number, x: number, y: number, state: Tree["state"]): Tree =>
  ({ id, x, y, kind: "baum", variant: 0, state, progress: 0, fallX: 1, fallY: 0, logs: 0, reservedBy: 0, ...(state === "waechst" ? { stage: 0, age: 0 } : {}) });

describe("Tiere auf Wegen und Brücken", () => {
  it("Wege sind für Tiere kein Hindernis, Gebäude schon; eine Brücke trägt erst fertig", () => {
    const { g, w } = leer(32);
    buildNow(g, "lager", 2, 2, 0);
    buildNow(g, "kiesweg", 10, 10, 0);
    buildNow(g, "haus", 14, 14, 0);
    expect(passable(w, 10.5, 10.5)).toBe(true);
    expect(passable(w, 14.5, 14.5)).toBe(false);
    for (let x = 20; x <= 22; x++) w.s.tiles[w.idx(x, 20)].terrain = "wasser";
    expect(passable(w, 21.5, 20.5)).toBe(false);
    const br = buildNow(g, "bruecke", 21, 20, 0);
    expect(BUILDINGS[br.key].road?.bridge).toBe(true);
    expect(passable(w, 21.5, 20.5)).toBe(true);
    br.built = 0.5;
    expect(passable(w, 21.5, 20.5)).toBe(false);
  });

  it("eine Herde grast über einen Weg hinweg, der mitten durch ihr Streifgebiet führt", () => {
    const { g, w } = leer(40);
    buildNow(g, "lager", 2, 2, 0);
    stockUp(g, "stein", 40);
    for (let x = 12; x <= 28; x++) buildNow(g, "kiesweg", x, 20, 0);
    w.s.animals = [];
    const herd = spawnGroup(w, "schaf", 0);
    for (const a of herd) { a.x = a.px = a.hx = a.tx = 20.5; a.y = a.py = a.hy = a.ty = 19.5; }
    let onRoad = 0;
    run(g, 240 * TPS, () => {
      for (const a of herd) {
        const t = w.s.tiles[w.idx(Math.floor(a.x), Math.floor(a.y))];
        if (t.building) { expect(BUILDINGS[w.buildings.get(t.building)!.key].road).toBeTruthy(); onRoad++; }
      }
    });
    expect(onRoad).toBeGreaterThan(0);
  });
});

describe("Wald und Felder", () => {
  it("ein Stumpf auf einem Beet treibt nicht wieder aus", () => {
    const { g, w } = leer(40);
    buildNow(g, "lager", 2, 2, 0);
    const farm = buildNow(g, "bauernhof", 16, 16, 0);
    const p = farm.farm!.plots[0];
    const t = tree(900, p.x, p.y, "stumpf");
    w.s.trees.push(t);
    run(g, (LIFE.forest.stumpSeconds + 10) * TPS);
    expect(t.state).toBe("stumpf");
  });

  it("nachwachsende Bäume sperren die Felder nicht, das neue Feld räumt sie; stehende Bäume sperren weiter", () => {
    const { g, w } = leer(40);
    buildNow(g, "lager", 2, 2, 0);
    stockUp(g, "holz", 60);
    stockUp(g, "stein", 60);
    const rect = fieldRect("bauernhof", 16, 16, 0);
    const before = g.canPlace("bauernhof", 16, 16, 0);
    expect(before.ok).toBe(true);
    // jedes Beet bekommt einen Setzling: der Hof geht trotzdem, und die Setzlinge verschwinden mit dem Setzen
    const saplings = rect.map(([x, y], i) => tree(800 + i, x, y, "waechst"));
    w.s.trees.push(...saplings);
    expect(g.canPlace("bauernhof", 16, 16, 0).ok).toBe(true);
    expect(g.dispatch({ t: "bauen", key: "bauernhof", x: 16, y: 16, o: 0 }).ok).toBe(true);
    const farm = g.state.buildings.find((b) => b.key === "bauernhof")!;
    expect(farm.farm!.plots.length).toBe(rect.length);
    for (const s of saplings) expect(g.state.trees.includes(s)).toBe(false);
    // stehende Bäume auf allen Feldkacheln: zu wenig Beete
    const { g: g2, w: w2 } = leer(40);
    buildNow(g2, "lager", 2, 2, 0);
    w2.s.trees.push(...rect.map(([x, y], i) => tree(800 + i, x, y, "stehend")));
    expect(g2.canPlace("bauernhof", 16, 16, 0).ok).toBe(false);
  });

  it("Krähen landen auch auf fruchtbarem Boden (ADR 0012), dem Land der Felder", () => {
    expect(ANIMALS.kraehe.terrain).toContain("fruchtbar");
  });
});
