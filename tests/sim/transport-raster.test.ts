import { describe, expect, it } from "vitest";
import { BUILDINGS, type BuildingKey, type TerrainKey } from "../../src/data";
import { completeBuilding, removeBuilding } from "../../src/sim/build";
import { createGame, loadGame, type Simulation } from "../../src/sim/game";
import { buildNow, run, stockUp } from "../../src/sim/debug";
import { Nav } from "../../src/sim/nav";
import { nextRandom, seedState } from "../../src/sim/rng";
import type { SBuilding, World } from "../../src/sim/world";
import { TPS } from "../../src/sim/world";

// ADR 0015: Das Laufraster wird nach Änderungen nur für die betroffenen Kacheln neu bestimmt (Nav.refresh). Eigenschaft:
// Nach jeder beliebigen Folge von Änderungen ist es genau das Raster, das ein vollständiger Neuaufbau ergäbe.

/** Vollständiger Neuaufbau zum Vergleich (eigenes Nav-Objekt, ändert die Welt nicht). */
function fresh(w: World): Nav {
  const n = new Nav(w);
  n.rebuild(false);
  return n;
}

/** Gleicher Inhalt zweier Felder. */
function same(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Gleiche Einteilung in Komponenten (Nummern dürfen sich unterscheiden, −1 = nicht begehbar muss gleich sein). */
function samePartition(a: Int32Array, b: Int32Array): boolean {
  const ab = new Map<number, number>(), ba = new Map<number, number>();
  for (let i = 0; i < a.length; i++) {
    if ((a[i] < 0) !== (b[i] < 0)) return false;
    if (a[i] < 0) continue;
    const x = ab.get(a[i]), y = ba.get(b[i]);
    if (x === undefined) ab.set(a[i], b[i]); else if (x !== b[i]) return false;
    if (y === undefined) ba.set(b[i], a[i]); else if (y !== a[i]) return false;
  }
  return true;
}

const linkSet = (m: Map<number, number[]>) => [...m].filter(([, l]) => l.length).map(([k, l]) => `${k}:${[...l].sort((a, b) => a - b).join(",")}`).sort();

function expectSame(w: World, why: string): void {
  const a = w.nav, b = fresh(w);
  for (let l = 0; l < 3; l++) expect(same(a.walk[l], b.walk[l]), `${why}: Ebene ${l}`).toBe(true);
  expect(same(a.cost, b.cost), `${why}: Kosten`).toBe(true);
  expect(same(a.z, b.z), `${why}: Höhen`).toBe(true);
  expect(same(a.linkOnly, b.linkOnly), `${why}: Übergangsknoten`).toBe(true);
  expect(linkSet(a.links), `${why}: Übergänge`).toEqual(linkSet(b.links));
  expect(linkSet(a.ownLinks), `${why}: Turmtüren`).toEqual(linkSet(b.ownLinks));
  for (let t = 0; t < 2; t++) expect(samePartition(a.comp[t], b.comp[t]), `${why}: Komponenten Team ${t}`).toBe(true);
  // Treppenhöhen an einigen Punkten jedes Treppen-Tiles
  for (const s of w.s.buildings) if (BUILDINGS[s.key].stairs) for (let dx = -1; dx <= 2; dx++) for (let dy = -1; dy <= 3; dy++) {
    for (const f of [0.2, 0.5, 0.8]) expect(a.stairZ(s.x + dx + f, s.y + dy + f)).toBe(b.stairZ(s.x + dx + f, s.y + dy + f));
  }
}

const KEYS: BuildingKey[] = ["haus", "holzfaeller", "lager", "kaserne", "turm", "treppe", "tor", "muehle", "kiesweg", "pflaster", "bruecke", "kornkammer"];

/** Zufällige Änderungen über die Befehle und die Regeln des Spiels (Bauen, Mauern, Fertigstellen, Abriss, Fels, Gelände). */
function randomEdits(g: Simulation, seed: number, steps: number, check: (why: string) => void): void {
  const w = g.world, meta = { rng: seedState(seed) };
  const r = () => nextRandom(meta);
  const ri = (n: number) => Math.floor(r() * n);
  const W = g.state.w;
  for (let i = 0; i < steps; i++) {
    const k = ri(10);
    let why = "";
    if (k < 3) {
      const key = KEYS[ri(KEYS.length)], x = ri(W), y = ri(W), o = ri(4);
      if (g.canPlace(key, x, y, o).ok) { g.dispatch({ t: "bauen", key, x, y, o }); why = `bauen ${key} ${x},${y},${o}`; }
    } else if (k < 5) {
      const x = ri(W - 8) + 4, y = ri(W - 8) + 4, len = 2 + ri(8), dir = ri(2);
      const res = g.dispatch({ t: "mauer", x0: x, y0: y, x1: dir ? x + len : x, y1: dir ? y : y + len });
      why = `mauer ${x},${y} ${res.ok}`;
    } else if (k < 7) {
      const sites = w.s.buildings.filter((b) => b.built < 1);
      if (sites.length) { const b = sites[ri(sites.length)]; completeBuilding(w, b); why = `fertig ${b.key} ${b.id}`; }
    } else if (k < 8) {
      const list = w.s.buildings.filter((b) => !BUILDINGS[b.key].seat);
      if (list.length) { const b = list[ri(list.length)] as SBuilding; removeBuilding(w, b, ri(2) ? "abriss" : "zerstoert"); why = `weg ${b.key} ${b.id}`; }
    } else if (k < 9) {
      const rocks = w.s.rocks;
      if (rocks.length) { const rock = rocks[ri(rocks.length)]; w.s.rocks = rocks.filter((x) => x !== rock); w.nav.refresh(); why = `fels ${rock.x},${rock.y}`; }
    } else {
      // Gelände ändern (z. B. künftige Geländearbeiten): Wasser, Gras oder Fels
      const x = ri(W), y = ri(W), t = (["wasser", "gras", "fels", "erde"] as TerrainKey[])[ri(4)];
      const tile = w.s.tiles[y * W + x];
      if (!tile.building) { tile.terrain = t; w.nav.refresh(); why = `gelaende ${x},${y} ${t}`; }
    }
    if (why) check(`${i}: ${why}`);
  }
}

describe("Laufraster inkrementell (ADR 0015)", () => {
  for (const seed of [1, 7, 23]) it(`nach jeder zufälligen Änderung gleich dem Neuaufbau (Seed ${seed}, 150 Schritte)`, () => {
    const g = createGame({ seed, raids: false });
    stockUp(g, "holz", 1000); stockUp(g, "stein", 1000);
    g.state.gold = 100000;
    let n = 0;
    randomEdits(g, seed * 31 + 5, 150, (why) => { expectSame(g.world, why); n++; });
    expect(n).toBeGreaterThan(40);
    // die Komponenten wurden meist örtlich nachgeführt, nicht neu beschriftet
    expect(g.world.nav.stats.patched).toBeGreaterThan(g.world.nav.stats.relabels);
    // Bergfried ausbauen (Plattform auf Ebene 2 mit Turmtür)
    const seat = g.world.s.buildings.find((b) => BUILDINGS[b.key].seat)!;
    for (const level of [2, 3]) { seat.level = level; g.world.nav.refresh(); expectSame(g.world, `Bergfried Stufe ${level}`); }
  });

  it("rechnet nur die betroffenen Kacheln neu, nicht die ganze Karte", () => {
    const g = createGame({ seed: 1, size: 96, raids: false });
    stockUp(g, "holz", 200);
    const w = g.world, t0 = w.nav.stats.tiles;
    g.dispatch({ t: "bauen", key: "haus", x: 30, y: 60, o: 0 });
    expect(w.nav.stats.tiles - t0).toBeLessThan(40); // Grundriss 2 × 2 samt Rand, statt 96 · 96 = 9216
    expectSame(w, "Haus");
  });

  it("ein fertiger Weg ändert nur Kosten: Komponenten und der übrige Pfad-Cache bleiben", () => {
    const g = createGame({ scenario: "leer", size: 48 });
    buildNow(g, "lager", 20, 20, 0);
    stockUp(g, "stein", 100);
    const w = g.world, nav = w.nav;
    // erstes Pflaster: senkt die untere Kostenschranke der Suche, danach bleibt sie gleich
    completeBuilding(w, w.buildings.get(g.dispatch({ t: "bauen", key: "pflaster", x: 44, y: 44, o: 0 }).ids![0])!);
    // Weg weit weg vom gesuchten Weg
    const far = nav.route(0, false, nav.node(0, 2, 2), { layer: 0, x0: 8, y0: 2, x1: 8, y1: 2, d: 0 });
    expect(far).toHaveLength(6);
    const kept = nav.stats.kept;
    const comp = nav.comp[0];
    const res = g.dispatch({ t: "bauen", key: "pflaster", x: 40, y: 40, o: 0 });
    expect(res.ok).toBe(true);
    completeBuilding(w, w.buildings.get(res.ids![0])!);
    expect(nav.comp[0]).toBe(comp); // nicht neu beschriftet (gleiches Feld, keine Neuberechnung nötig)
    const hits = nav.hits;
    expect(nav.route(0, false, nav.node(0, 2, 2), { layer: 0, x0: 8, y0: 2, x1: 8, y1: 2, d: 0 })).toBe(far);
    expect(nav.hits).toBe(hits + 1);
    expect(nav.stats.kept).toBeGreaterThan(kept);
    expectSame(w, "Pflaster");
  });
});

describe("Pfad-Cache ist für das Ergebnis unsichtbar (ADR 0015)", () => {
  /** Spiel mit Bauen, Abriss und Marschbefehlen; clear = Cache nach jedem Tick leeren (jede Suche frisch). */
  function play(clear: boolean): string {
    const g = createGame({ seed: 5, raids: true });
    stockUp(g, "holz", 200); stockUp(g, "stein", 200);
    g.state.gold = 5000;
    const w = g.world;
    for (let t = 0; t < 120 * TPS; t++) {
      if (t % (6 * TPS) === 0) {
        const k: BuildingKey[] = ["haus", "kiesweg", "pflaster", "holzfaeller"];
        const key = k[(t / (6 * TPS)) % 4];
        for (let d = 0; d < 30; d++) {
          const x = 20 + ((t / TPS + d * 7) % 24), y = 26 + ((d * 5) % 14);
          if (g.canPlace(key, x, y, d % 4).ok) { g.dispatch({ t: "bauen", key, x, y, o: d % 4 }); break; }
        }
      }
      if (t === 40 * TPS) g.dispatch({ t: "ueberfall" });
      g.tick();
      if (clear) (w.nav as unknown as { cache: Map<string, unknown> }).cache.clear();
    }
    expect(w.nav.searches).toBeGreaterThan(50);
    if (!clear) { expect(w.nav.stats.kept).toBeGreaterThan(0); expect(w.nav.hits).toBeGreaterThan(0); }
    return JSON.stringify(w.s);
  }

  it("mit Cache und gezielter Invalidierung entsteht derselbe Spielverlauf wie mit frischer Suche bei jedem Schritt", () => {
    const a = play(false), b = play(true);
    expect(a === b).toBe(true);
  }, 60_000);

  it("Laden mitten im Spiel (leerer Cache, neu aufgebautes Raster) läuft gleich weiter", () => {
    const g = createGame({ seed: 9, raids: true });
    stockUp(g, "stein", 120);
    g.dispatch({ t: "mauer", x0: 40, y0: 30, x1: 40, y1: 40 });
    run(g, 30 * TPS);
    g.dispatch({ t: "bauen", key: "kiesweg", x: 26, y: 37, o: 0 });
    run(g, 10 * TPS);
    const saved = g.save();
    run(g, 40 * TPS);
    const l = loadGame(saved);
    run(l, 40 * TPS);
    expect(JSON.stringify(l.state)).toBe(JSON.stringify(g.state));
  }, 60_000);
});
