import { describe, expect, it } from "vitest";
import { BUILDINGS, TICKS_PER_SECOND as TPS } from "../../src/data";
import { createGame, loadGame } from "../../src/sim";
import { buildCap, siteUsed } from "../../src/sim/build";
import { buildNow, run, worldOf } from "../../src/sim/debug";
import { entrance, footprintTiles } from "../../src/sim/geom";
import { findSpot, lagerOf } from "./helpers";

const sum = (r: Partial<Record<string, number>>) => Object.values(r).reduce((a: number, n) => a + (n ?? 0), 0);

describe("Bauen mit Material und Arbeit", () => {
  it("Fortschritt nie über dem verbauten Material, Stapel auf der Baustelle werden verbraucht, Bau beginnt vor der letzten Lieferung", () => {
    const g = createGame({ seed: 2, raids: false });
    const l = lagerOf(g);
    const [x, y] = findSpot(g, "kaserne", l.x + 7, l.y - 5);
    const r = g.dispatch({ t: "bauen", key: "kaserne", x, y, o: 0 });
    expect(r.ok).toBe(true);
    const site = worldOf(g).buildings.get(r.ids![0])!;
    expect(site.mat).toBe(35);
    let over = false, earlyStart = false, shrank = false, lastPile = 0, sawWork = 0;
    run(g, 240 * TPS, () => {
      if (site.built >= 1) return true;
      if (site.built > buildCap(site) + 1e-9) over = true;
      if (site.built > 0 && sum(site.needs) > 0) earlyStart = true;
      const pile = sum(site.site);
      if (pile < lastPile && sum(site.needs) + pile + siteUsed(site) === 35) shrank = true;
      lastPile = pile;
      if (g.state.units.some((u) => u.anim === "bauen")) sawWork++;
    });
    expect(site.built).toBe(1);
    expect(over).toBe(false);
    expect(earlyStart).toBe(true);
    expect(shrank).toBe(true);
    // Arbeitszeit mindestens die Bauzeit (ein Bauarbeiter, 1 / (buildSeconds · TPS) je Tick)
    expect(sawWork).toBeGreaterThanOrEqual(BUILDINGS.kaserne.buildSeconds * TPS - 1);
    expect(site.mat).toBeUndefined();
    expect(site.site).toEqual({});
  });

  it("ohne Material im Lager bleibt die Baustelle abgesteckt, niemand baut; nach der Lieferung geht es weiter", () => {
    const g = createGame({ scenario: "leer", size: 40 });
    buildNow(g, "lager", 4, 4, 0);
    for (let i = 0; i < 4; i++) worldOf(g).addUnit("tageloehner", 0, 8.5 + i, 10.5);
    const r = g.dispatch({ t: "bauen", key: "mauer", x: 15, y: 15, o: 0 });
    expect(r.ok).toBe(false); // ohne Stein lässt sich nichts setzen (Kosten werden geprüft)
    const w = worldOf(g);
    // Baustelle direkt anlegen (wie nach dem Setzen), das Material fehlt im Lager
    const site = w.addBuilding("mauer", 0, 15, 15, 0);
    for (const [tx, ty] of footprintTiles("mauer", 15, 15, 0)) w.s.tiles[w.idx(tx, ty)].building = site.id;
    site.needs = { stein: 3 }; site.mat = 3;
    w.nav.rebuild();
    run(g, 30 * TPS);
    expect(site.built).toBe(0);
    expect(g.state.units.some((u) => u.anim === "bauen")).toBe(false);
    // Material liegt auf der Baustelle: jetzt wird gebaut, Stück für Stück
    site.needs = {}; site.site = { stein: 3 };
    run(g, 60 * TPS, () => site.built >= 1);
    expect(site.built).toBe(1);
  });

  it("der Bauarbeiter wechselt beim Hämmern die Seite der Baustelle", () => {
    const g = createGame({ seed: 2, raids: false });
    const l = lagerOf(g);
    const [x, y] = findSpot(g, "kaserne", l.x + 7, l.y - 5);
    const id = g.dispatch({ t: "bauen", key: "kaserne", x, y, o: 0 }).ids![0];
    const site = worldOf(g).buildings.get(id)!;
    const spots = new Set<string>();
    run(g, 240 * TPS, () => {
      for (const u of g.state.units) if (u.anim === "bauen") spots.add(`${Math.floor(u.x)},${Math.floor(u.y)}`);
      return site.built >= 1;
    });
    expect(site.built).toBe(1);
    expect(spots.size).toBeGreaterThanOrEqual(3);
    // gehämmert wird nur neben dem Grundriss, nie darauf
    const fp = new Set(footprintTiles("kaserne", x, y, 0).map(([a, b]) => `${a},${b}`));
    for (const s of spots) expect(fp.has(s)).toBe(false);
  });

  it("Abriss einer frischen Baustelle gibt kein Material zurück, das nie geliefert wurde; liegendes Material kommt zurück", () => {
    const g = createGame({ seed: 2, raids: false });
    const l = lagerOf(g);
    const holz = g.state.stock.holz;
    const [x, y] = findSpot(g, "haus", l.x + 6, l.y - 4);
    const id = g.dispatch({ t: "bauen", key: "haus", x, y, o: 0 }).ids![0];
    g.dispatch({ t: "abreissen", id });
    run(g, 2);
    expect(g.state.stock.holz).toBe(holz);
    // zweite Baustelle: warten, bis Holz dort liegt, aber noch nichts verbaut ist
    const id2 = g.dispatch({ t: "bauen", key: "haus", x, y, o: 0 }).ids![0];
    const site = worldOf(g).buildings.get(id2)!;
    run(g, 120 * TPS, () => (site.site.holz ?? 0) >= 2 && site.built === 0);
    const lying = site.site.holz ?? 0;
    expect(lying).toBeGreaterThan(0);
    // Was Träger gerade in der Hand haben, bringen sie zurück; was dort liegt, kommt sofort zurück
    const before = g.state.stock.holz;
    g.dispatch({ t: "abreissen", id: id2 });
    run(g, 1);
    expect(g.state.stock.holz).toBeGreaterThanOrEqual(before + lying);
    run(g, 60 * TPS);
    expect(g.state.stock.holz).toBe(holz);
  });

  it("Spielstand mitten im Bau: verbautes Material und Fortschritt bleiben gleich", () => {
    const g = createGame({ seed: 2, raids: false });
    const l = lagerOf(g);
    const [x, y] = findSpot(g, "haus", l.x + 6, l.y - 4);
    const id = g.dispatch({ t: "bauen", key: "haus", x, y, o: 0 }).ids![0];
    const site = worldOf(g).buildings.get(id)!;
    run(g, 120 * TPS, () => site.built > 0.3);
    expect(site.built).toBeGreaterThan(0.3);
    const h = loadGame(g.save());
    run(g, 5 * TPS); run(h, 5 * TPS);
    const a = g.state.buildings.find((b) => b.id === id)!, b = h.state.buildings.find((q) => q.id === id)!;
    expect(b.built).toBe(a.built);
    expect(b.site).toEqual(a.site);
    expect(b.mat).toBe(a.mat);
  });
  it("Lagerhaus als Baustelle: Bauen beginnt vor der letzten Lieferung, danach lagern Träger durch das Tor ein", () => {
    const g = createGame({ seed: 2, raids: false });
    const w = worldOf(g);
    const l = lagerOf(g);
    const [x, y] = findSpot(g, "lager", l.x - 8, l.y + 6);
    const r = g.dispatch({ t: "bauen", key: "lager", x, y, o: 1 });
    expect(r.ok).toBe(true);
    const site = w.buildings.get(r.ids![0])!;
    expect(site.mat).toBe(10);
    let over = false, earlyStart = false;
    run(g, 240 * TPS, () => {
      if (site.built > buildCap(site) + 1e-9) over = true;
      if (site.built > 0 && sum(site.needs) > 0) earlyStart = true;
      return site.built >= 1;
    });
    expect(site.built).toBe(1);
    expect(over).toBe(false);
    expect(earlyStart).toBe(true);
    expect(site.slots).toHaveLength(BUILDINGS.lager.storage!.slots);
    // Holzfäller gleich daneben: sein Holz kommt ins neue Lagerhaus, und zwar durch das Tor
    const [hx, hy] = findSpot(g, "holzfaeller", x - 2, y + 4);
    buildNow(g, "holzfaeller", hx, hy, 0);
    const [ex, ey] = entrance("lager", site.x, site.y, site.o);
    const foot = new Set(footprintTiles("lager", site.x, site.y, site.o).map(([a, b]) => `${a},${b}`));
    let entered = 0;
    const seen = new Set<number>();
    run(g, 240 * TPS, () => {
      for (const u of w.units.values()) {
        if (u.inside === site.id) {
          if (!seen.has(u.id)) { seen.add(u.id); entered++; expect(Math.hypot(u.x - (ex + 0.5), u.y - (ey + 0.5))).toBeLessThan(1.01); }
        } else {
          seen.delete(u.id);
          if (u.layer === 0 && !u.dead) expect(foot.has(`${Math.floor(u.x)},${Math.floor(u.y)}`)).toBe(false);
        }
      }
      return site.slots.some((q) => q.good === "holz" && q.amount >= 2);
    });
    expect(entered).toBeGreaterThan(0);
    expect(site.slots.some((q) => q.good === "holz" && q.amount >= 2)).toBe(true);
  });
});
