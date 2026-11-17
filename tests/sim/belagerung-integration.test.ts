/**
 * Zusammenführung Belagerung (ADR 0017) mit Wegen und inkrementellem Laufraster (ADR 0015), Militärwirtschaft
 * (ADR 0014) und Einheitenraster: Leitern, Trümmer und Gräben im Raster, das nur betroffene Kacheln nachzieht,
 * Leitern nur gegen Mauern, Wege kein Ziel, reine Angreifer nicht im Einheitenraster, Wucht des Rammbocks.
 */
import { describe, expect, it } from "vitest";
import { BUILDINGS, DAMAGE_TYPES, UNITS, type UnitKey } from "../../src/data";
import { createGame } from "../../src/sim";
import { hasLadderWall } from "../../src/sim/belagerung";
import { placeSite, removeBuilding } from "../../src/sim/build";
import { buildNow, spawn, worldOf } from "../../src/sim/debug";
import { Nav } from "../../src/sim/nav";
import { spawnWave } from "../../src/sim/raid";
import type { Ladder } from "../../src/sim/types";
import type { World } from "../../src/sim/world";
import { ROSTER } from "../../src/ui/roster";

const linkSet = (m: Map<number, number[]>) => [...m].filter(([, l]) => l.length).map(([k, l]) => `${k}:${[...l].sort((a, b) => a - b).join(",")}`).sort();

/** Nach refresh() dasselbe Raster wie nach einem vollständigen Neuaufbau, auch die Leiterübergänge der Angreifer. */
function expectSame(w: World, why: string): void {
  const a = w.nav, b = new Nav(w);
  b.rebuild(false);
  for (let l = 0; l < 3; l++) expect([...a.walk[l]], `${why}: Ebene ${l}`).toEqual([...b.walk[l]]);
  expect([...a.cost], `${why}: Kosten`).toEqual([...b.cost]);
  expect(linkSet(a.links), `${why}: Übergänge`).toEqual(linkSet(b.links));
  expect(linkSet(a.foeLinks), `${why}: Leitern`).toEqual(linkSet(b.foeLinks));
  for (const t of [0, 1] as const) {
    const ca = a.comp[t], cb = b.comp[t], ab = new Map<number, number>();
    for (let i = 0; i < ca.length; i++) {
      expect(ca[i] < 0, `${why}: Komponente ${t}`).toBe(cb[i] < 0);
      if (ca[i] < 0) continue;
      const x = ab.get(ca[i]);
      if (x === undefined) ab.set(ca[i], cb[i]); else expect(x, `${why}: Komponente ${t}`).toBe(cb[i]);
    }
  }
}

describe("Belagerung im inkrementellen Laufraster (ADR 0015 + 0017)", () => {
  it("Leitern, Trümmer, Gräben und Neubau auf der Bresche: refresh() ergibt dasselbe wie ein Neuaufbau", () => {
    const g = createGame({ scenario: "leer", size: 40, raids: false });
    const w = worldOf(g);
    for (let y = 5; y < 30; y++) buildNow(g, "mauer", 20, y, 0);
    for (let y = 5; y < 30; y++) buildNow(g, "graben", 23, y, 0);
    w.nav.refresh();
    expectSame(w, "Mauer und Graben");
    // Graben: eigene Leute waten, Angreifer nur im Durchbruchmodus, Fahrzeuge nie
    const ditch = w.nav.node(0, 23, 10);
    expect(w.nav.pass(ditch, 0, false)).toBeGreaterThan(0);
    expect(w.nav.pass(ditch, 1, false)).toBe(-1);
    expect(w.nav.pass(ditch, 1, true)).toBeGreaterThan(0);
    expect(w.nav.pass(ditch, 1, true, true)).toBe(-1);
    // Leiter aufstellen: Übergang nur für Angreifer, ohne Neuaufbau
    const rebuilds = w.nav.stats.rebuilds;
    const ladder: Ladder = { id: w.newId(), x: 21, y: 12, wx: 20, wy: 12, o: 3, state: "steht", t: 0, push: 0 };
    (w.s.ladders ??= []).push(ladder);
    w.nav.refresh();
    expect(w.nav.foeLinks.get(w.nav.node(0, 21, 12))).toContain(w.nav.node(1, 20, 12));
    expect(w.nav.stats.rebuilds).toBe(rebuilds);
    expectSame(w, "Leiter steht");
    // Mauerstück zerstört: Leiter kippt, Trümmer bleiben als Bresche (begehbar, teurer)
    const piece = w.s.buildings.find((b) => b.key === "mauer" && b.x === 20 && b.y === 12)!;
    removeBuilding(w, piece as never, "zerstoert");
    expect(ladder.state).not.toBe("steht");
    expect(w.s.rubble?.some((r) => r.x === 20 && r.y === 12)).toBe(true);
    expectSame(w, "Bresche");
    expect(w.nav.walk[0][12 * w.s.w + 20]).toBe(1);
    // Neubau räumt die Trümmer
    placeSite(w, "mauer", 20, 12, 0);
    expect(w.s.rubble?.some((r) => r.x === 20 && r.y === 12)).toBe(false);
    expectSame(w, "Neubau auf der Bresche");
    expect(w.nav.stats.rebuilds).toBe(rebuilds);
  });
});

describe("Wellen passen sich der Befestigung an", () => {
  it("ohne Mauer mit Wehrgang bringt Welle 2 keine Sturmleitern, sondern Krieger; mit Mauer zwei Leitern", () => {
    const g = createGame({ seed: 1 });
    const w = worldOf(g);
    expect(hasLadderWall(w)).toBe(false);
    spawnWave(w);
    const w2 = spawnWave(w).map((id) => w.units.get(id)!);
    expect(w2.filter((u) => u.gear === "leiter")).toHaveLength(0);
    expect(w2.filter((u) => !UNITS[u.key].vehicle)).toHaveLength(6);
    const g2 = createGame({ seed: 1 });
    const v = worldOf(g2);
    let placed = false;
    for (let y = 2; y < v.s.h - 2 && !placed; y++) for (let x = 2; x < v.s.w - 2 && !placed; x++) {
      if (g2.canPlace("mauer", x, y, 0).ok) { buildNow(g2, "mauer", x, y, 0); placed = true; }
    }
    expect(hasLadderWall(v)).toBe(true);
    spawnWave(v);
    expect(spawnWave(v).map((id) => v.units.get(id)!).filter((u) => u.gear === "leiter")).toHaveLength(2);
  });
});

describe("Wege, Rammbock und Einheitenraster", () => {
  it("der Rammbock greift keinen Weg an, auch wenn er am nächsten liegt", () => {
    const g = createGame({ scenario: "leer", size: 40, raids: false });
    buildNow(g, "kiesweg", 12, 10, 0);
    const haus = buildNow(g, "haus", 30, 30, 0);
    const ram = spawn(g, "rammbock", 1, 10, 10);
    for (let i = 0; i < 3; i++) spawn(g, "sturmknecht", 1, 9, 9 + i).ai.ram = ram.id;
    for (let t = 0; t < 40; t++) g.tick();
    expect(ram.ai.targetB).toBe(haus.id);
  });

  it("reine Angreifer (Sturmknecht, Rammbock) stehen nicht im Einheitenraster des Spielers", () => {
    const all = ROSTER.flatMap((gr) => gr.entries.map((e) => e.key));
    for (const k of Object.keys(UNITS) as UnitKey[]) if (UNITS[k].foeOnly) expect(all, k).not.toContain(k);
    expect(UNITS.sturmknecht.foeOnly && UNITS.rammbock.foeOnly).toBe(true);
  });

  it("Wucht ist eine Schadensart für alle (Morgenstern, Schleuder, Rammbock); der Rammbock trifft Gebäude mit 60 je Stoß", () => {
    expect(UNITS.rammbock.damageType).toBe("wucht");
    expect(UNITS.rammbock.damage! * DAMAGE_TYPES.wucht.building).toBeCloseTo(60);
    expect(BUILDINGS.kiesweg.road).toBeDefined();
  });
});
