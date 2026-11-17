import { describe, expect, it } from "vitest";
import { UNITS, WALL_BONUS, type UnitKey } from "../../src/data";
import { createGame, postWorld } from "../../src/sim";
import { buildNow, run, spawn } from "../../src/sim/debug";
import type { Simulation } from "../../src/sim/game";
import { TPS } from "../../src/sim/world";
import { findSpot, lagerOf } from "./helpers";

describe("Rekrutierung", () => {
  it("verbraucht Gold und Waffe; ein Tagelöhner trägt die Waffe zur Kaserne und kommt als Soldat heraus", () => {
    const g = createGame({ seed: 1, raids: false });
    const l = lagerOf(g);
    const [kx, ky] = findSpot(g, "kaserne", l.x + 6, l.y - 5);
    const k = buildNow(g, "kaserne", kx, ky, 0);
    const r = g.dispatch({ t: "rekrutieren", building: k.id, unit: "speer" });
    expect(r.ok).toBe(true);
    expect(g.state.gold).toBe(150 - UNITS.speer.train!.gold);
    expect(k.queue).toEqual(["speer"]);
    const peasants = g.state.units.filter((u) => u.key === "tageloehner").length;
    let carrier = 0, inTraining = false;
    run(g, 60 * TPS, () => {
      const c = g.state.units.find((u) => u.key === "tageloehner" && u.carry === "speer");
      if (c) carrier = c.id;
      inTraining ||= !!k.training;
      return g.state.units.some((u) => u.key === "speer");
    });
    expect(carrier).toBeGreaterThan(0);
    expect(inTraining).toBe(true);
    const soldier = g.state.units.find((u) => u.key === "speer")!;
    expect(soldier.id).toBe(carrier); // derselbe Mensch, jetzt Soldat
    expect(soldier.hp).toBe(UNITS.speer.hp);
    expect(g.state.stock.speer).toBe(2);
    expect(g.state.units.filter((u) => u.key === "tageloehner")).toHaveLength(peasants - 1);
    expect(k.queue).toEqual([]);
  });

  it("lehnt ab ohne Waffe oder Gold", () => {
    const g = createGame({ seed: 1, raids: false });
    const l = lagerOf(g);
    const [kx, ky] = findSpot(g, "kaserne", l.x + 6, l.y - 5);
    const k = buildNow(g, "kaserne", kx, ky, 0);
    for (let i = 0; i < 2; i++) expect(g.dispatch({ t: "rekrutieren", building: k.id, unit: "schwert" }).ok).toBe(true);
    expect(g.dispatch({ t: "rekrutieren", building: k.id, unit: "schwert" }).reason).toBe("Keine Schwerter im Lager");
    g.state.gold = 5;
    expect(g.dispatch({ t: "rekrutieren", building: k.id, unit: "bogen" }).reason).toBe("Nicht genug Gold");
  });
});

/** Leere Wiese mit Mauerlinie (10..19, 20) und optional Treppe und Turm. */
function fort(withStairs: boolean, withTower = false): Simulation {
  const g = createGame({ scenario: "leer", size: 40 });
  for (let x = 10; x <= 19; x++) buildNow(g, "mauer", x, 20, 0);
  if (withStairs) buildNow(g, "treppe", 12, 21, 0); // Rückseite an (12, 20)
  if (withTower) buildNow(g, "turm", 20, 19, 0); // 2 × 2 an das Mauerende
  return g;
}

describe("Laufebenen", () => {
  it("Einheit am Boden erreicht den Wehrgang nur über die Treppe", () => {
    const g = fort(false);
    const u = spawn(g, "speer", 0, 15, 25);
    expect(g.walkLayerAt(15, 20)).toBe(1);
    g.dispatch({ t: "bewegen", units: [u.id], x: 15, y: 20 });
    run(g, 20 * TPS);
    expect(u.layer).toBe(0);
    expect(u.z).toBe(0);
    // Mit Treppe: hinauf, z steigt unterwegs sichtbar
    buildNow(g, "treppe", 12, 21, 0);
    g.dispatch({ t: "bewegen", units: [u.id], x: 15, y: 20 });
    const zs: [number, number, number][] = [];
    run(g, 30 * TPS, () => { zs.push([Math.floor(u.x), Math.floor(u.y), u.z]); });
    expect(u.layer).toBe(1);
    expect(u.z).toBe(3);
    expect(Math.floor(u.x)).toBe(15); expect(Math.floor(u.y)).toBe(20);
    const mid = zs.filter(([, , z]) => z > 0 && z < 3);
    expect(mid.length).toBeGreaterThan(5);
    // Jede Zwischenhöhe liegt auf der Treppe (x 12, y 21..22) oder am Übergang zur Mauer (12, 20)
    for (const [x, y] of mid) { expect(x).toBe(12); expect(y).toBeGreaterThanOrEqual(20); expect(y).toBeLessThanOrEqual(22); }
    // Erst unten auf der Treppe, dann höher
    const firstUp = zs.findIndex(([, , z]) => z > 0);
    expect(zs[firstUp][1]).toBeGreaterThanOrEqual(21);
  });

  it("Tor: eigene Leute gehen durch, Angreifer nicht", () => {
    const g = createGame({ scenario: "leer", size: 40 });
    for (let y = 0; y < 40; y++) buildNow(g, y === 20 ? "tor" : "mauer", 20, y, 1);
    const w = (g as any).world;
    const a = w.nav.node(0, 10, 20), b = w.nav.node(0, 30, 20);
    expect(w.nav.comp[0][a]).toBe(w.nav.comp[0][b]);
    expect(w.nav.comp[1][a]).not.toBe(w.nav.comp[1][b]);
    const u = spawn(g, "schwert", 0, 10, 22);
    g.dispatch({ t: "bewegen", units: [u.id], x: 30, y: 22 });
    run(g, 30 * TPS);
    expect(Math.floor(u.x)).toBe(30);
  });
});

describe("Stationierung", () => {
  it("verteilt auf freie Posten ohne Doppelbelegung, Schützen zuerst auf den Turm an der Feindseite", () => {
    const g = fort(true, true); // Überfälle kommen im leeren Szenario von Osten (x = 39), der Turm steht am Ostende
    const ids: number[] = [];
    for (let i = 0; i < 16; i++) ids.push(spawn(g, "bogen", 0, 8 + (i % 8), 26 + Math.floor(i / 8)).id);
    // 10 Mauerposten + 4 Turmposten
    const first = g.dispatch({ t: "stationieren", units: ids.slice(0, 3) });
    expect(first.ok).toBe(true);
    expect(first.voice).toBe("stationiert");
    const near = first.ids!.map((id) => g.state.units.find((u) => u.id === id)!.order).map((o) => o.t === "station" ? g.state.buildings.find((b) => b.id === o.building)! : null);
    for (const b of near) expect(b!.key).toBe("turm");
    const rest = g.dispatch({ t: "stationieren", units: ids.slice(3) });
    expect(rest.ok).toBe(true);
    expect(rest.ids).toHaveLength(11);
    expect(rest.reason).toBe("Nicht genug freie Posten für alle");
    expect(rest.voice).toBe("kein_posten");
    const posts = g.state.units.filter((u) => u.order.t === "station").map((u) => u.order.t === "station" ? `${u.order.building}:${u.order.post}` : "");
    expect(posts).toHaveLength(14);
    expect(new Set(posts).size).toBe(14);
    run(g, 60 * TPS);
    const stationed = g.state.units.filter((u) => u.order.t === "station");
    for (const u of stationed) {
      if (u.order.t !== "station") continue;
      const b = g.state.buildings.find((x) => x.id === (u.order as any).building)!;
      const [px, py, pz] = postWorld(b.key, b.x, b.y, b.o, u.order.post);
      expect(Math.hypot(u.x - px, u.y - py)).toBeLessThan(0.01);
      expect(u.z).toBe(pz);
      expect(u.layer).toBe(b.key === "turm" ? 2 : 1);
    }
    const spots = new Set(stationed.map((u) => `${u.x.toFixed(2)},${u.y.toFixed(2)},${u.z}`));
    expect(spots.size).toBe(14);
    const none = g.dispatch({ t: "stationieren", units: ids.slice(14) });
    expect(none.ok).toBe(false);
    expect(none.voice).toBe("kein_posten");
  });
});

/** Gefecht: 6 Bogenschützen gegen 3 Schwertkämpfer und 3 Bogenschützen. */
function battle(seed: number, withWall: boolean): boolean {
  const g = createGame({ scenario: "leer", size: 48, seed });
  (g as any).world.meta.rng = seed * 7919;
  buildNow(g, "haus", 4, 22, 0); // Ziel der Angreifer hinter der Linie
  const defenders: number[] = [];
  for (let i = 0; i < 6; i++) defenders.push(spawn(g, "bogen", 0, 17, 19 + i).id);
  if (withWall) {
    for (let y = 0; y < 48; y++) buildNow(g, "mauer", 20, y, 1);
    buildNow(g, "treppe", 18, 23, 3); // westlich der Mauer, oben an (20, 23)
    g.dispatch({ t: "stationieren", units: defenders });
    run(g, 20 * TPS);
    for (const id of defenders) expect(g.state.units.find((u) => u.id === id)!.layer).toBe(1);
  }
  const attackers: UnitKey[] = ["schwert", "bogen", "schwert", "bogen", "schwert", "bogen"];
  attackers.forEach((k, i) => spawn(g, k, 1, 34 + (i % 2), 20 + i));
  run(g, 240 * TPS, () => !g.state.units.some((u) => u.team === 1 && !u.dead) || !g.state.units.some((u) => u.team === 0 && !u.dead));
  return !g.state.units.some((u) => u.team === 1 && !u.dead) && g.state.units.some((u) => u.team === 0 && !u.dead);
}

describe("Mauerverteidigung", () => {
  it("Schützen auf der Mauer gewinnen öfter als ohne Mauer", () => {
    expect(WALL_BONUS.damageTakenFactor).toBeLessThan(1);
    const seeds = [1, 2, 3, 4, 5, 6];
    const wall = seeds.filter((s) => battle(s, true)).length;
    const open = seeds.filter((s) => battle(s, false)).length;
    console.log(`Mauerverteidigung: mit Mauer ${wall}/6 Siege, ohne Mauer ${open}/6 Siege`);
    expect(wall).toBeGreaterThan(open);
    expect(wall).toBeGreaterThanOrEqual(4);
  });

  it("Angreifer reißen Mauern ein, wenn kein Weg herumführt", () => {
    const g = createGame({ scenario: "leer", size: 32 });
    for (let y = 0; y < 32; y++) buildNow(g, "mauer", 16, y, 1);
    const house = buildNow(g, "haus", 4, 14, 0);
    spawn(g, "schwert", 1, 26, 15);
    run(g, 200 * TPS, () => !g.state.buildings.includes(house));
    expect(g.state.buildings.filter((b) => b.key === "mauer").length).toBeLessThan(32);
    expect(g.state.buildings.includes(house)).toBe(false);
  });
});

describe("Überfall", () => {
  it("kommt nach Zeitplan von Osten und greift die Siedlung an", () => {
    const g = createGame({ seed: 4 });
    expect(g.state.raid.next).toBe(300 * TPS);
    const r = g.dispatch({ t: "ueberfall" });
    expect(r.ids).toHaveLength(4);
    expect(g.state.raid.wave).toBe(1);
    const raiders = g.state.units.filter((u) => u.team === 1);
    for (const u of raiders) expect(u.x).toBeGreaterThan(g.state.w * 0.85);
    run(g, 2);
    expect(g.state.raid.active).toBe(true);
    expect(g.state.messages.some((m) => m.kind === "kampf")).toBe(true);
    const l = lagerOf(g);
    const startD = Math.min(...raiders.map((u) => Math.hypot(u.x - l.x, u.y - l.y)));
    run(g, 40 * TPS);
    const alive = raiders.filter((u) => !u.dead);
    if (alive.length) expect(Math.min(...alive.map((u) => Math.hypot(u.x - l.x, u.y - l.y)))).toBeLessThan(startD - 10);
    g.dispatch({ t: "ueberfall" });
    expect(g.state.units.filter((u) => u.team === 1 && !u.dead).length).toBeGreaterThanOrEqual(6);
  });

  it("Tote fallen, liegen und verschwinden", () => {
    const g = createGame({ scenario: "leer", size: 24 });
    // Opfer ist ein eigener Speerträger: verwundete Angreifer würden sich zurückziehen statt zu fallen
    const a = spawn(g, "schwert", 1, 10, 10), b = spawn(g, "speer", 0, 12, 10);
    b.hp = 5;
    run(g, 5 * TPS, () => b.dead);
    expect(b.dead).toBe(true);
    expect(b.anim).toBe("sterben");
    run(g, 2 * TPS);
    expect(b.anim).toBe("tot");
    run(g, 10 * TPS);
    expect(g.state.units.includes(b)).toBe(false);
    expect(a.dead).toBe(false);
  });
});
