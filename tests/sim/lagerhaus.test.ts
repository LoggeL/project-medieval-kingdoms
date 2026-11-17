import { describe, expect, it } from "vitest";
import { BUILDINGS, START } from "../../src/data";
import { createGame } from "../../src/sim";
import { nearestEnemy } from "../../src/sim/combat";
import { buildNow, run, spawn } from "../../src/sim/debug";
import { entrance, footprintTiles, shelfWorld } from "../../src/sim/geom";
import { storeVisit, walkOut } from "../../src/sim/jobs";
import { TPS, type SUnit, type World } from "../../src/sim/world";
import { findSpot, lagerOf } from "./helpers";
import BUILD_DEFS from "../../tools/blender/buildings/buildings.json";

describe("Lagerhaus (geschlossen, Zugang nur durch das Tor)", () => {
  it("Startaufbau kommt aus den Daten: ein Lagerhaus an der Startstelle der Karte", () => {
    expect(START.buildings.some((b) => b.key === "lager")).toBe(true);
    const g = createGame({ seed: 1 });
    for (const sb of START.buildings) {
      const found = g.state.buildings.filter((b) => b.key === sb.key && b.o === sb.o && b.built >= 1);
      expect(found.length, sb.key).toBeGreaterThan(0);
    }
    expect(g.state.buildings.filter((b) => b.key === "lager")).toHaveLength(START.buildings.filter((b) => b.key === "lager").length);
    expect(BUILDINGS.lager.door).toBeDefined();
    expect(BUILDINGS.lager.storage!.shelves).toHaveLength(BUILDINGS.lager.storage!.slots);
  });

  it("Fächer im Schnittbild (Blender) und in den Spieldaten liegen an derselben Stelle", () => {
    const defs = BUILD_DEFS as unknown as Record<string, { shelves?: number[][] }>;
    expect(defs.lagerhaus_innen.shelves).toEqual(BUILDINGS.lager.storage!.shelves);
    expect(BUILDINGS.lager.interior?.sprite).toBe("lagerhaus_innen");
  });

  it("Träger betreten das Lagerhaus nur am Tor, sind drinnen unsichtbar für Gegner und kommen wieder heraus", () => {
    const g = createGame({ seed: 1, raids: false });
    const w = (g as any).world as World;
    const l = lagerOf(g);
    const [ex, ey] = entrance(l.key, l.x, l.y, l.o);
    const foot = new Set(footprintTiles(l.key, l.x, l.y, l.o).map(([x, y]) => `${x},${y}`));
    const [x, y] = findSpot(g, "holzfaeller", 17, 30);
    buildNow(g, "holzfaeller", x, y, 0);
    const wasInside = new Map<number, number>();
    let entries = 0, stockUpWhileInside = 0, stockUpTotal = 0, maxStay = 0;
    let prevHolz = g.state.stock.holz ?? 0;
    run(g, 200 * TPS, (t) => {
      for (const u of w.units.values()) {
        if (u.inside === l.id) {
          if (!wasInside.has(u.id)) {
            // gerade eingetreten: steht am Tor
            entries++;
            expect(Math.hypot(u.x - (ex + 0.5), u.y - (ey + 0.5))).toBeLessThan(1.01);
            wasInside.set(u.id, t);
          }
          maxStay = Math.max(maxStay, t - wasInside.get(u.id)!);
        } else {
          wasInside.delete(u.id);
          // draußen nie im Grundriss des Lagerhauses
          if (u.layer === 0 && !u.dead) expect(foot.has(`${Math.floor(u.x)},${Math.floor(u.y)}`)).toBe(false);
        }
      }
      const holz = g.state.stock.holz ?? 0;
      if (holz > prevHolz) {
        stockUpTotal++;
        if ([...w.units.values()].some((u) => u.inside === l.id)) stockUpWhileInside++;
      }
      prevHolz = holz;
    });
    expect(entries).toBeGreaterThan(0);
    expect(stockUpTotal).toBeGreaterThan(0);
    expect(stockUpWhileInside).toBe(stockUpTotal); // eingelagert wird nur drinnen am Fach
    expect(maxStay).toBeLessThan(15 * TPS); // niemand bleibt drinnen stecken
  });

  it("in allen vier Ausrichtungen: hinein am gedrehten Tor, Warentausch am Fach, wieder hinaus", () => {
    for (const o of [0, 1, 2, 3]) {
      const g = createGame({ seed: 1, raids: false });
      const w = (g as any).world as World;
      const l0 = lagerOf(g);
      const [lx, ly] = findSpot(g, "lager", l0.x + 8, l0.y, o);
      const b = buildNow(g, "lager", lx, ly, o);
      const [ex, ey] = entrance(b.key, b.x, b.y, b.o);
      const u = spawn(g, "tageloehner", 0, ex, ey + (o === 0 ? 1 : 0)) as SUnit;
      let r = "";
      let entered: [number, number] | null = null;
      for (let i = 0; i < 60 * TPS && r !== "arrived"; i++) {
        r = storeVisit(w, u, b, 3);
        if (u.inside && !entered) entered = [u.x, u.y];
        if (r === "unreachable") break;
      }
      expect(r, `o=${o}`).toBe("arrived");
      expect(entered).not.toBeNull();
      expect(Math.hypot(entered![0] - (ex + 0.5), entered![1] - (ey + 0.5)), `o=${o}`).toBeLessThan(1.01);
      const [sx, sy] = shelfWorld(b.key, b.x, b.y, b.o, 3);
      expect(Math.hypot(u.x - sx, u.y - sy), `o=${o}`).toBeLessThan(1);
      expect(u.inside).toBe(b.id);
      let n = 0;
      while (walkOut(w, u) && n++ < 30 * TPS);
      expect(u.inside).toBeUndefined();
      expect(Math.hypot(u.x - (ex + 0.5), u.y - (ey + 0.5)), `o=${o}`).toBeLessThan(1.01);
    }
  });

  it("Figuren im Gebäude sind kein Ziel", () => {
    const g = createGame({ seed: 1, raids: false });
    const w = (g as any).world as World;
    const l = lagerOf(g);
    const [ex, ey] = entrance(l.key, l.x, l.y, l.o);
    const foe = spawn(g, "schwert", 1, ex, ey + 1) as SUnit;
    const me = spawn(g, "tageloehner", 0, ex, ey) as SUnit;
    run(g, 1); // Nachbarschaftsraster aufbauen
    for (const u of w.units.values()) if (u.team === 0 && u !== me) u.inside = l.id;
    expect(nearestEnemy(w, foe, 6)?.id).toBe(me.id);
    me.inside = l.id;
    expect(nearestEnemy(w, foe, 6)).toBeNull();
  });
});
