/**
 * Regressionstests zu den Befunden der Gesamtprüfung von Welle 2 (Simulation): Reparatur und Verplanung, Essen nach dem
 * Sieg, Sturmleiter vor einem Weg, Rammbock vor einem geschlossenen Graben, Rezeptwechsel mit Ware unterwegs, Rekrut in
 * einer zerstörten Kaserne.
 */
import { describe, expect, it } from "vitest";
import { createGame, stairEnds } from "../../src/sim";
import { buildNow, run, spawn, stockUp } from "../../src/sim/debug";
import { removeBuilding } from "../../src/sim/build";
import { available, committed, stockOf, updateStock } from "../../src/sim/storage";
import { COMMAND_TUNING, LIFE, UNITS } from "../../src/data";
import { center } from "../../src/sim/geom";
import { speedOf } from "../../src/sim/move";
import { TPS } from "../../src/sim/world";
import { findSpot, lagerOf } from "./helpers";

describe("Reparatur und verplante Waren", () => {
  it("eine Reparatur, die ihr Stück noch holt, zählt als verplant; Reparaturen nehmen der Baustelle nichts weg", () => {
    const g = createGame({ seed: 1, raids: false });
    const w = g.world, l = lagerOf(g);
    const walls = [0, 1, 2].map((i) => { const [x, y] = findSpot(g, "mauer", l.x + 8 + i * 3, l.y + 6, 0, 10); return buildNow(g, "mauer", x, y, 0); });
    for (const b of walls) b.hp = 10;
    for (const b of w.s.buildings) for (const s of b.slots) if (s.good === "stein") { s.amount = 0; s.good = null; }
    updateStock(w);
    stockUp(g, "stein", 7);
    stockUp(g, "holz", 20);
    const [bx, by] = findSpot(g, "baeckerei", l.x - 6, l.y - 8, 0, 20);
    const r = g.dispatch({ t: "bauen", key: "baeckerei", x: bx, y: by, o: 0 });
    expect(r.ok).toBe(true);
    const site = w.buildings.get(r.ids![0])!;
    expect(committed(w, "stein")).toBe(6);
    let maxRep = 0, sawCommit = false;
    run(g, 60 * TPS, () => {
      const reps = w.s.units.filter((u) => u.ai.job?.k === "repair");
      maxRep = Math.max(maxRep, reps.length);
      if (reps.some((u) => u.ai.job?.k === "repair" && u.ai.job.ph === 0)) sawCommit ||= available(w, "stein") === 0;
    });
    expect(maxRep).toBe(1); // genau ein freies Stück, also genau eine Reparatur
    expect(sawCommit).toBe(true);
    expect(site.built).toBe(1);
  });
});

describe("Ernährung nach dem Sieg", () => {
  it("nach dem Sieg wird weiter gegessen, der Brotbestand sinkt", () => {
    const g = createGame({ seed: 2 });
    g.state.match.stats.waves = 5;
    run(g, 2);
    expect(g.state.outcome).toBe("sieg");
    const eaten = g.state.food!.eaten, brot = stockOf(g.world, "brot");
    run(g, 180 * TPS);
    expect(g.state.food!.eaten).toBeGreaterThan(eaten);
    expect(stockOf(g.world, "brot")).toBeLessThan(brot);
  });
});

/** Aufbau für eine Seite (k = 0..3): Mauer quer über die Karte, außen ein Weg, innen eine Treppe, außen ein Sturmknecht; innen ein Haus als Ziel. */
function ladderSetup(k: number, road: boolean) {
  const N = 40;
  const rot = (x: number, y: number): [number, number] =>
    k === 0 ? [x, y] : k === 1 ? [N - 1 - y, x] : k === 2 ? [N - 1 - x, N - 1 - y] : [y, N - 1 - x];
  const g = createGame({ scenario: "leer", size: N, raids: false });
  g.world.meta.immigration = false; // nur Mauer, Weg und Angreifer (kein Notzuzug ins Haus)
  for (let y = 0; y < N; y++) { const [x1, y1] = rot(20, y); buildNow(g, "mauer", x1, y1, 0); }
  if (road) for (let y = 0; y < N; y++) { const [x1, y1] = rot(21, y); buildNow(g, "kiesweg", x1, y1, 0); }
  const [wx, wy] = rot(20, 12);
  let placed = false;
  for (let o = 0; o < 4 && !placed; o++) for (let dy = -3; dy <= 3 && !placed; dy++) for (let dx = -3; dx <= 3 && !placed; dx++) {
    const e = stairEnds(wx + dx, wy + dy, o);
    if (e.wall[0] !== wx || e.wall[1] !== wy) continue;
    // Treppe innen (auf der Seite von x < 20 im Grundaufbau)
    const inside = (p: [number, number]) => { for (let x = 0; x < 20; x++) for (let y = 0; y < N; y++) { const q = rot(x, y); if (q[0] === p[0] && q[1] === p[1]) return true; } return false; };
    if (!inside(e.top) || !inside(e.bottom)) continue;
    buildNow(g, "treppe", wx + dx, wy + dy, o); placed = true;
  }
  expect(placed).toBe(true);
  const [hx, hy] = rot(8, 19);
  buildNow(g, "haus", hx, hy, 0);
  const [ux, uy] = rot(30, 25);
  const u = spawn(g, "sturmknecht", 1, ux, uy); u.gear = "leiter";
  return { g, u, rot };
}

describe("Sturmleiter und Wege", () => {
  for (let k = 0; k < 4; k++) {
    it(`ein Kiesweg außen an der Mauer verhindert die Leiter nicht (Seite ${k})`, () => {
      const counts: number[] = [];
      for (const road of [false, true]) {
        const { g, u, rot } = ladderSetup(k, road);
        let onWall = false;
        run(g, 40 * TPS, () => { onWall ||= g.world.units.get(u.id)?.layer === 1; });
        counts.push(g.state.ladders?.length ?? 0);
        expect(onWall).toBe(true); // über die Leiter auf den Wehrgang
        // danach über die Treppe hinunter nach innen (Seite x < 20 im Grundaufbau)
        const me = g.world.units.get(u.id)!;
        const [ix, iy] = [Math.floor(me.x), Math.floor(me.y)];
        let inside = false;
        for (let x = 0; x < 20 && !inside; x++) for (let y = 0; y < 40 && !inside; y++) { const q = rot(x, y); inside = q[0] === ix && q[1] === iy; }
        expect(inside).toBe(true);
        expect(me.layer).toBe(0);
      }
      expect(counts).toEqual([1, 1]);
    });
  }
});

describe("Rammbock vor einem Graben", () => {
  it("ein geschlossener Graben ohne Bresche: Rammbock und Mannschaft ziehen ab, die Welle endet", () => {
    const g = createGame({ scenario: "leer", size: 40, raids: false, goal: "tal" });
    for (let y = 0; y < 40; y++) buildNow(g, "graben", 22, y, 0);
    buildNow(g, "haus", 8, 19, 0);
    buildNow(g, "bergfried", 6, 10, 0);
    const ram = spawn(g, "rammbock", 1, 32, 20);
    for (let i = 0; i < 3; i++) spawn(g, "sturmknecht", 1, 33, 19 + i).ai.ram = ram.id;
    g.world.meta.raidRunning = true;
    let end = -1;
    run(g, 300 * TPS, (t) => { if (!g.world.meta.raidRunning) { end = t; return true; } });
    expect(end).toBeGreaterThan(0);
    expect(end).toBeLessThan(120 * TPS);
    expect(g.state.units.some((u) => u.team === 1 && !u.dead)).toBe(false);
  });
});

describe("Rezeptwechsel mit Ware unterwegs", () => {
  it("Holz, das für das alte Rezept unterwegs war, landet nicht im Puffer, sondern wieder im Lager", () => {
    const g = createGame({ seed: 1, raids: false });
    const w = g.world, l = lagerOf(g);
    w.s.research.done.push("gewalthaufen");
    const [x, y] = findSpot(g, "waffenschmiede", l.x + 2, l.y - 6, 0, 20);
    const b = buildNow(g, "waffenschmiede", x, y, 0);
    stockUp(g, "eisen", 6); stockUp(g, "holz", 20);
    expect(g.dispatch({ t: "rezept", building: b.id, recipe: "pike_schmieden" }).ok).toBe(true);
    let found = false;
    run(g, 120 * TPS, () => (found = w.s.units.some((u) => u.ai.job?.k === "supply" && u.ai.job.pk && u.ai.job.site === b.id && u.ai.job.good === "holz" && u.ai.job.ph === 1)));
    expect(found).toBe(true);
    const holz = (): number => stockOf(w, "holz") + w.s.units.filter((u) => u.carry === "holz").length + (b.proc!.in.holz ?? 0);
    const before = holz();
    expect(g.dispatch({ t: "rezept", building: b.id, recipe: "schwert_schmieden" }).ok).toBe(true);
    run(g, 60 * TPS);
    expect(b.proc!.in.holz ?? 0).toBe(0);
    expect(b.proc!.enroute.holz ?? 0).toBe(0);
    expect(holz()).toBe(before); // nichts verloren, alles wieder im Lager
    expect(w.s.units.some((u) => u.carry === "holz")).toBe(false);
  });
});

describe("Rekrut in der Kaserne", () => {
  function training() {
    const g = createGame({ seed: 1, raids: false });
    const l = lagerOf(g);
    const [x, y] = findSpot(g, "kaserne", l.x + 3, l.y - 8, 0, 20);
    const k = buildNow(g, "kaserne", x, y, 0);
    expect(g.dispatch({ t: "rekrutieren", building: k.id, unit: "speer" }).ok).toBe(true);
    run(g, 60 * TPS, () => !!k.training);
    expect(k.training).not.toBeNull();
    run(g, 1);
    return { g, k };
  }
  it("wird die Kaserne zerstört, zählt der Rekrut als Verlust", () => {
    const { g, k } = training();
    removeBuilding(g.world, k, "zerstoert");
    run(g, 1);
    expect(g.state.match.stats.lostWorkers + g.state.match.stats.lostSoldiers).toBe(1);
  });
  it("beim Abriss tritt der Rekrut als Tagelöhner heraus", () => {
    const { g, k } = training();
    const pop = g.state.population;
    removeBuilding(g.world, k, "abriss");
    run(g, 1);
    expect(g.state.population).toBe(pop);
    expect(g.state.match.stats.lostWorkers + g.state.match.stats.lostSoldiers).toBe(0);
  });
});

describe("Steinbruch und reservierter Fels", () => {
  it("hält ein Kollege den letzten Fels in Reichweite, meldet der Steinbruch nicht „kein Fels mehr“", () => {
    const g = createGame({ seed: 1, raids: false });
    expect(g.dispatch({ t: "bauen", key: "steinbruch", x: 33, y: 17, o: 0 }).ok).toBe(true);
    const q = g.state.buildings.find((b) => b.key === "steinbruch")!;
    const [cx, cy] = center(q.key, q.x, q.y, q.o);
    const radius = 8; // reserveNearest des Steinbruchs (BUILDINGS.steinbruch)
    const left = () => g.world.s.rocks.some((r) => r.amount > 0 && !r.kind && Math.hypot(r.x + 0.5 - cx, r.y + 0.5 - cy) <= radius);
    let shared = false, falseMsg = false;
    run(g, 400 * TPS, () => {
      const res = g.world.s.rocks.filter((r) => r.reservedBy && Math.hypot(r.x + 0.5 - cx, r.y + 0.5 - cy) <= radius);
      const free = g.world.s.rocks.filter((r) => !r.reservedBy && r.amount > 0 && !r.kind && Math.hypot(r.x + 0.5 - cx, r.y + 0.5 - cy) <= radius);
      if (res.length && !free.length) shared = true;
      if (left() && g.state.messages.some((m) => m.text.includes("kein Fels mehr"))) falseMsg = true;
    });
    expect(q.workers.length).toBe(2);
    expect(shared).toBe(true); // die Lage aus der Prüfung trat ein: ein Arbeiter hält den letzten freien Fels
    expect(falseMsg).toBe(false);
  });
});

describe("Tempo beim Rennen", () => {
  it("LIFE.run.factor gilt für fliehende Arbeiter; der Rückzug der Soldaten wird nicht zusätzlich beschleunigt", () => {
    const g = createGame({ scenario: "leer", size: 40, raids: false });
    const w = g.world;
    const p = spawn(g, "tageloehner", 0, 10.5, 10.5);
    const walk = speedOf(w, p);
    p.run = true;
    expect(speedOf(w, p)).toBeCloseTo(walk * LIFE.run.factor);
    const s = spawn(g, "speer", 0, 12.5, 12.5);
    expect(g.dispatch({ t: "rueckzug", units: [s.id] }).ok).toBe(true);
    run(g, 2);
    expect(s.run).toBe(true);
    expect(speedOf(w, s)).toBeCloseTo(UNITS.speer.speed * COMMAND_TUNING.retreatSpeed);
  });
});
