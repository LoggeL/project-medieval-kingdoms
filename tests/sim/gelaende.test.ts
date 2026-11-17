/**
 * Landschaft (ADR 0012): Generator, Bauregeln je Geländeart, Wege ums Gebirge, Startsiedlung bleibt spielbar,
 * Steinvorkommen und Nachrutschen an der Geröllhalde, Langlauf mit Steinbruch an der Halde.
 */
import { describe, expect, it } from "vitest";
import { FELD_BODEN, STEIN, TERRAIN, feldErlaubt, fruchtbarkeit, type TerrainKey } from "../../src/data";
import { createGame, entrance, loadGame } from "../../src/sim";
import { buildNow, run, spawn, stockUp, worldOf } from "../../src/sim/debug";
import { slopeRocks, slopeTiles, updateSlides, wouldSplit } from "../../src/sim/gelaende";
import { tidy, updateStock } from "../../src/sim/storage";
import type { Simulation } from "../../src/sim/game";
import { generateMap, mountainClass } from "../../src/sim/mapgen";
import { nextRandom, seedState } from "../../src/sim/rng";
import { TPS, type World } from "../../src/sim/world";
import { findSpot, lagerOf } from "./helpers";

const NEU: TerrainKey[] = ["gebirge", "huegel", "sumpf", "sand", "fruchtbar"];
const count = (g: Simulation, t: TerrainKey) => g.state.tiles.filter((x) => x.terrain === t).length;
const terrainAt = (w: World, x: number, y: number) => w.s.tiles[w.idx(x, y)].terrain;

/** Kacheln, die team 0 vom Eingang des Startlagers aus erreicht (Ebene 0). */
function reachFromLager(g: Simulation): (x: number, y: number) => boolean {
  const w = worldOf(g), l = lagerOf(g);
  const [ex, ey] = entrance("lager", l.x, l.y, l.o);
  const c = w.nav.comp[0][w.nav.node(0, ex, ey)];
  expect(c).toBeGreaterThanOrEqual(0);
  return (x, y) => w.nav.comp[0][w.nav.node(0, x, y)] === c;
}

/** Ist ein Brocken oder Baum von einer begehbaren Nachbarkachel aus erreichbar? */
function reachableObject(w: World, ok: (x: number, y: number) => boolean, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if ((dx || dy) && w.inMap(x + dx, y + dy) && ok(x + dx, y + dy)) return true;
  }
  return false;
}

describe("Kartengenerator mit Landschaft", () => {
  it("ist deterministisch: gleicher Seed, gleiche Karte; anderer Seed, andere Landschaft", () => {
    const key = (seed: number, size = 64) => {
      const s = createGame({ seed, size, raids: false }).state;
      return JSON.stringify([s.tiles, s.trees, s.rocks]);
    };
    expect(key(4)).toBe(key(4));
    expect(key(4, 96)).toBe(key(4, 96));
    expect(key(4)).not.toBe(key(5));
    // generateMap direkt: gleicher Zufall, gleiche Karte
    const gen = () => {
      const meta = { rng: seedState(9) };
      let n = 1;
      return generateMap(48, 48, () => nextRandom(meta), () => n++, 9);
    };
    const a = gen(), b = gen();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("legt jede neue Geländeart an, bei 64 und bei 96 Feldern", () => {
    for (const [seed, size] of [[1, 64], [2, 64], [3, 64], [7, 64], [1, 96], [2, 96]]) {
      const g = createGame({ seed, size, raids: false });
      for (const t of NEU) expect(count(g, t), `${t} Seed ${seed} Größe ${size}`).toBeGreaterThan(size === 96 ? 40 : 20);
      // Küste: Sand und Wasser in der südlichen Kartenreihe
      const s = g.state, south = s.tiles.slice((s.h - 1) * s.w);
      expect(south.some((t) => t.terrain === "wasser")).toBe(true);
      // Gipfel im Massiv (Höhenklasse 2 für die Darstellung)
      let peak = 0;
      for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.tiles[y * s.w + x].terrain === "gebirge" && mountainClass(s.tiles, s.w, s.h, x, y) === 2) peak++;
      expect(peak).toBeGreaterThan(5);
    }
  });

  it("Bäume nur auf Boden, der sie trägt; Brocken nur auf Fels", () => {
    for (const seed of [1, 2, 3]) {
      const s = createGame({ seed, raids: false }).state;
      for (const t of s.trees) expect(["waldboden", "gras", "wiese", "huegel", "fruchtbar", "sumpf"]).toContain(s.tiles[t.y * s.w + t.x].terrain);
      for (const r of s.rocks) expect(s.tiles[r.y * s.w + r.x].terrain).toBe("fels");
      // keine doppelten IDs (Landschaft bekommt ihre IDs nach der Startaufstellung)
      const ids = [...s.trees.map((t) => t.id), ...s.rocks.map((r) => r.id), ...s.buildings.map((b) => b.id), ...s.units.map((u) => u.id)];
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every((id) => id > 0)).toBe(true);
    }
  });
});

describe("Bauregeln je Geländeart", () => {
  it("Sumpf und Gebirge sind kein Bauland; Hügel, Sand und fruchtbarer Boden schon", () => {
    const g = createGame({ scenario: "leer", size: 24, seed: 2 });
    const w = worldOf(g);
    const setArea = (t: TerrainKey) => { for (let y = 8; y < 14; y++) for (let x = 8; x < 14; x++) w.s.tiles[w.idx(x, y)].terrain = t; w.nav.rebuild(); };
    for (const t of NEU) {
      setArea(t);
      const chk = g.canPlace("haus", 10, 10, 0);
      if (TERRAIN[t].buildable) {
        expect(chk.tiles.every((c) => c.ok), t).toBe(true);
      } else {
        expect(chk.ok).toBe(false);
        expect(chk.reason).toBe(`${TERRAIN[t].name} ist kein Bauland`);
      }
    }
    expect(TERRAIN.sumpf.buildable || TERRAIN.gebirge.buildable).toBe(false);
    expect(TERRAIN.gebirge.walkable).toBe(false);
    expect(TERRAIN.sumpf.walkable && TERRAIN.huegel.walkable).toBe(true);
    // langsamer: Sumpf am langsamsten, Hügel dazwischen
    expect(TERRAIN.sumpf.cost).toBeGreaterThan(TERRAIN.huegel.cost);
    expect(TERRAIN.huegel.cost).toBeGreaterThan(TERRAIN.gras.cost);
  });

  it("Felder: fruchtbarer Boden voll, Wiese mit weniger Ertrag, sonst keine (Abfrage für den Ackerbau)", () => {
    expect(feldErlaubt("fruchtbar")).toBe(true);
    expect(feldErlaubt("wiese")).toBe(true);
    for (const t of ["gras", "sumpf", "sand", "gebirge", "fels", "huegel", "wasser", "erde", "waldboden"] as TerrainKey[]) expect(feldErlaubt(t), t).toBe(false);
    expect(fruchtbarkeit("fruchtbar")).toBe(1);
    expect(fruchtbarkeit("wiese")).toBeGreaterThan(0);
    expect(fruchtbarkeit("wiese")).toBeLessThan(1);
    expect(fruchtbarkeit("sumpf")).toBe(0);
    for (const k of Object.keys(FELD_BODEN)) expect(TERRAIN[k as TerrainKey]).toBeDefined();
  });
});

describe("Wege", () => {
  it("führen ums Gebirge herum, nie hindurch, und meiden einen Sumpf, wenn der Bogen kurz ist", () => {
    const g = createGame({ scenario: "leer", size: 32, seed: 2 });
    const w = worldOf(g);
    // Riegel aus Gebirge von y = 2 bis 27 bei x = 15, 16
    for (let y = 2; y < 28; y++) for (const x of [15, 16]) w.s.tiles[w.idx(x, y)].terrain = "gebirge";
    w.nav.rebuild();
    const path = w.nav.route(0, false, w.nav.node(0, 5, 15), { layer: 0, x0: 26, y0: 15, x1: 26, y1: 15, d: 0 })!;
    expect(path).not.toBeNull();
    for (const n of path) expect(terrainAt(w, w.nav.tileX(n), w.nav.tileY(n))).not.toBe("gebirge");
    expect(path.some((n) => w.nav.tileY(n) < 2 || w.nav.tileY(n) >= 28)).toBe(true);
    // Sumpfstreifen 3 breit, 5 lang: der Weg geht außen herum
    const h = createGame({ scenario: "leer", size: 32, seed: 2 });
    const v = worldOf(h);
    for (let y = 13; y < 18; y++) for (let x = 14; x < 17; x++) v.s.tiles[v.idx(x, y)].terrain = "sumpf";
    v.nav.rebuild();
    const p2 = v.nav.route(0, false, v.nav.node(0, 8, 15), { layer: 0, x0: 22, y0: 15, x1: 22, y1: 15, d: 0 })!;
    expect(p2.filter((n) => terrainAt(v, v.nav.tileX(n), v.nav.tileY(n)) === "sumpf").length).toBe(0);
  });

  it("eine Figur läuft tatsächlich um das Massiv herum und kommt an", () => {
    const g = createGame({ scenario: "leer", size: 32, seed: 2 });
    const w = worldOf(g);
    for (let y = 0; y < 26; y++) for (const x of [15, 16]) w.s.tiles[w.idx(x, y)].terrain = "gebirge";
    w.nav.rebuild();
    const s = spawn(g, "speer", 0, 6, 8);
    expect(g.dispatch({ t: "bewegen", units: [s.id], x: 25, y: 8 }).ok).toBe(true);
    let onMountain = false;
    run(g, 60 * TPS, () => {
      if (terrainAt(w, Math.floor(s.x), Math.floor(s.y)) === "gebirge") onMountain = true;
      return Math.hypot(s.x - 25.5, s.y - 8.5) < 0.8;
    });
    expect(onMountain).toBe(false);
    expect(Math.hypot(s.x - 25.5, s.y - 8.5)).toBeLessThan(0.8);
  });
});

describe("Startsiedlung bleibt spielbar", () => {
  it("Wald, Fels und Wiese vom Lager erreichbar, Überfallweg von Osten frei (mehrere Seeds, 64 und 96)", () => {
    const cases: [number, number][] = [[1, 64], [2, 64], [3, 64], [4, 64], [5, 64], [6, 64], [11, 64], [1, 96], [3, 96]];
    for (const [seed, size] of cases) {
      const g = createGame({ seed, size, raids: false });
      const w = worldOf(g), s = g.state, l = lagerOf(g);
      const ok = reachFromLager(g);
      const near = (x: number, y: number, r: number) => Math.hypot(x - l.x, y - l.y) <= r;
      const R = size * 0.45;
      expect(s.trees.filter((t) => t.state === "stehend" && near(t.x, t.y, R) && reachableObject(w, ok, t.x, t.y)).length, `Bäume ${seed}/${size}`).toBeGreaterThan(30);
      expect(s.rocks.filter((r) => near(r.x, r.y, R) && reachableObject(w, ok, r.x, r.y)).length, `Brocken ${seed}/${size}`).toBeGreaterThan(5);
      let wiese = 0;
      for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.tiles[y * s.w + x].terrain === "wiese" && near(x, y, R) && ok(x, y)) wiese++;
      expect(wiese, `Wiese ${seed}/${size}`).toBeGreaterThan(60);
      // Holzfäller und Steinbruch finden einen Platz nahe der Startsiedlung
      expect(() => findSpot(g, "holzfaeller", l.x - 10, l.y + 4)).not.toThrow();
      expect(() => findSpot(g, "steinbruch", Math.round(s.w * 0.56), Math.round(s.h * 0.27))).not.toThrow();
      // Überfallweg: vom Ostrand zum Lager, ohne Gebirge
      const [rx, ry] = [s.w - 1, Math.floor(s.h * 0.5) + 2];
      const path = w.nav.route(1, false, w.nav.node(0, rx, ry), { layer: 0, x0: l.x, y0: l.y, x1: l.x + 2, y1: l.y + 2, d: 1 });
      expect(path, `Überfallweg ${seed}/${size}`).not.toBeNull();
      for (const n of path!) expect(terrainAt(w, w.nav.tileX(n), w.nav.tileY(n))).not.toBe("gebirge");
      // die Straße bleibt durchgehend Erde (außer der Furt)
      const road = s.tiles.slice(ry * s.w, (ry + 1) * s.w).filter((t) => t.terrain === "erde").length;
      expect(road).toBeGreaterThan(s.w - 6);
    }
  });
});

describe("Stein", () => {
  it("deutlich mehr Stein als vorher (164 bei Seed 1), weit verteilt: Felsfeld, Halde am Gebirge und Hügelkuppen", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const g = createGame({ seed, raids: false });
      const s = g.state;
      const stone = s.rocks.reduce((a, r) => a + r.amount, 0);
      expect(stone, `Seed ${seed}`).toBeGreaterThan(450);
      expect(slopeRocks(s).length).toBeGreaterThanOrEqual(STEIN.slideMax - 1);
      // weit verteilt: Brocken in mindestens drei Gegenden, die mehr als 15 Felder auseinanderliegen
      const groups: { x: number; y: number }[] = [];
      for (const r of s.rocks) if (!groups.some((q) => Math.hypot(q.x - r.x, q.y - r.y) < 15)) groups.push(r);
      expect(groups.length, `Seed ${seed}`).toBeGreaterThanOrEqual(3);
      // Felsfeld am Start wie vorher, neue Vorkommen reicher
      for (const r of s.rocks) { expect(r.max).toBeGreaterThanOrEqual(STEIN.field[0]); expect(r.max).toBeLessThanOrEqual(STEIN.amount[1]); }
      expect(s.rocks.some((r) => r.max > STEIN.field[1])).toBe(true);
    }
  });

  it("an der Geröllhalde rutscht nach dem Abbau Fels nach: deterministisch, nie trennend, Speichern und Laden gleich", () => {
    const mk = () => {
      const g = createGame({ seed: 1, raids: false });
      // Halde abgebaut
      const w = worldOf(g);
      for (const r of slopeRocks(g.state)) r.amount = 0;
      w.s.rocks = w.s.rocks.filter((r) => r.amount > 0);
      w.nav.rebuild();
      return g;
    };
    const a = mk(), b = mk();
    const wa = worldOf(a);
    const before = new Set(a.state.rocks.map((r) => r.id));
    expect(slopeRocks(a.state).length).toBe(0);
    let saved = "";
    const slid: { x: number; y: number }[] = [];
    run(a, STEIN.slideSeconds * TPS * (STEIN.slideMax + 2), (t) => {
      if (t === Math.round(STEIN.slideSeconds * TPS * 2.5)) saved = a.save();
      for (const r of a.state.rocks) if (!before.has(r.id) && !slid.some((q) => q.x === r.x && q.y === r.y)) slid.push(r);
    });
    run(b, STEIN.slideSeconds * TPS * (STEIN.slideMax + 2));
    expect(slid.length).toBe(STEIN.slideMax);
    expect(slopeRocks(a.state).length).toBe(STEIN.slideMax);
    const { set } = slopeTiles(a.state);
    for (const q of slid) expect(set[q.y * a.state.w + q.x]).toBe(1);
    for (const r of a.state.rocks.filter((r) => !before.has(r.id))) {
      expect(r.amount).toBeGreaterThanOrEqual(STEIN.slideAmount[0]);
      expect(r.amount).toBeLessThanOrEqual(STEIN.slideAmount[1]);
    }
    expect(JSON.stringify(b.state.rocks)).toBe(JSON.stringify(a.state.rocks));
    expect(a.state.messages.some((m) => m.text.startsWith("Am Gebirgshang ist Fels nachgerutscht"))).toBe(true);
    // voll: es rutscht nichts mehr nach
    const n = a.state.rocks.length;
    run(a, STEIN.slideSeconds * TPS * 3);
    expect(a.state.rocks.length).toBe(n);
    // kein nachgerutschter Brocken trennt Wege: alles, was vorher vom Lager erreichbar war, ist es noch
    const ok = reachFromLager(a);
    for (const q of slid) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = q.x + dx, y = q.y + dy;
        if (!wa.inMap(x, y) || !TERRAIN[terrainAt(wa, x, y)].walkable || a.state.rocks.some((r) => r.x === x && r.y === y)) continue;
        expect(ok(x, y), `${x},${y} neben ${q.x},${q.y}`).toBe(true);
      }
    }
    // Speichern und Laden: gleicher Verlauf
    const h = loadGame(saved);
    const g2 = loadGame(saved);
    run(h, STEIN.slideSeconds * TPS * 4);
    run(g2, STEIN.slideSeconds * TPS * 4);
    expect(h.save()).toBe(g2.save());
    expect(slopeRocks(h.state).length).toBe(STEIN.slideMax);
  });

  it("rutscht nie neben eine Figur, an einen Brocken oder vor eine Tür und nie so, dass ein Weg zerfällt", () => {
    const g = createGame({ seed: 1, raids: false });
    const w = worldOf(g);
    for (const r of slopeRocks(g.state)) r.amount = 0;
    w.s.rocks = w.s.rocks.filter((r) => r.amount > 0);
    w.nav.rebuild();
    for (let i = 0; i < 40; i++) {
      w.s.tick = Math.round(STEIN.slideSeconds * TPS) * (i + 1);
      const r = updateSlides(w);
      if (!r) continue;
      expect(w.s.rocks.filter((q) => q !== r).every((q) => Math.max(Math.abs(q.x - r.x), Math.abs(q.y - r.y)) >= 2)).toBe(true);
      expect(w.s.units.every((u) => Math.abs(u.x - (r.x + 0.5)) >= 2 || Math.abs(u.y - (r.y + 0.5)) >= 2)).toBe(true);
      // auf der Stelle des Brockens geprüft, ohne ihn: hätte er getrennt?
      w.s.rocks = w.s.rocks.filter((q) => q !== r);
      w.nav.rebuild(false);
      expect(wouldSplit(w, r.x, r.y)).toBe(false);
      w.s.rocks.push(r);
      w.nav.rebuild(false);
    }
    expect(slopeRocks(g.state).length).toBe(STEIN.slideMax);
  });
});

describe("Langlauf", () => {
  it("Steinbruch an der Geröllhalde, 24 000 Ticks: Stein kommt an, die Halde wird nachgefüllt, keiner betritt das Gebirge", () => {
    const g = createGame({ seed: 1, raids: false });
    const w = worldOf(g), s = g.state;
    const halde = slopeRocks(s);
    const cx = Math.round(halde.reduce((a, r) => a + r.x, 0) / halde.length), cy = Math.round(halde.reduce((a, r) => a + r.y, 0) / halde.length);
    const [qx, qy] = findSpot(g, "steinbruch", cx, cy + 3, 0, 12);
    const q = buildNow(g, "steinbruch", qx, qy, 0);
    const first = new Set(s.rocks.map((r) => r.id));
    let onMountain = 0, used = 0;
    run(g, 24000, (t) => {
      if (t % 10 === 0) {
        for (const u of s.units) if (!u.dead && u.layer === 0 && terrainAt(w, Math.floor(u.x), Math.floor(u.y)) === "gebirge") onMountain++;
      }
      // Stein wird verbaut (sonst ist das Lager bald voll und der Steinbruch hält an): freie Blöcke alle 30 s heraus.
      // Ohne Höfe wäre der Startvorrat Brot nach gut 10 min gegessen und die Tagelöhner gingen (ADR 0013); die Siedlung
      // wird hier wie der Stein von außen versorgt, denn geprüft wird die Halde, nicht die Ernährung.
      if (t % (30 * TPS) === 0) {
        if (s.stock.brot < 10) stockUp(g, "brot", 20);
        for (const b of s.buildings) for (const sl of b.slots) {
          if (sl.good !== "stein") continue;
          const n = sl.amount - sl.reserved;
          if (n > 0) { sl.amount -= n; used += n; }
          tidy(sl);
        }
        updateStock(w);
      }
    });
    expect(s.buildings.includes(q)).toBe(true);
    expect(onMountain).toBe(0);
    // die ersten Haldenbrocken sind abgebaut, an ihrer Stelle sind neue nachgerutscht
    expect(halde.some((r) => !s.rocks.includes(r))).toBe(true);
    expect(s.rocks.filter((r) => !first.has(r.id)).length).toBeGreaterThan(0);
    expect(used).toBeGreaterThan(150);
    expect(JSON.stringify(s)).not.toContain("NaN");
  });

  it("Überfälle nach Zeitplan, 9 000 Ticks auf mehreren Karten: keine Figur betritt das Gebirge", () => {
    for (const [seed, size] of [[1, 64], [6, 64], [2, 96]]) {
      const g = createGame({ seed, size });
      const w = worldOf(g), s = g.state;
      let onMountain = 0;
      run(g, 9000, (t) => {
        if (t === 100 * TPS) g.dispatch({ t: "ueberfall" });
        if (t % 10) return;
        for (const u of s.units) if (!u.dead && u.layer === 0 && terrainAt(w, Math.floor(u.x), Math.floor(u.y)) === "gebirge") onMountain++;
      });
      expect(onMountain, `Seed ${seed}/${size}`).toBe(0);
      expect(s.raid.wave, `Seed ${seed}/${size}`).toBeGreaterThan(0);
      expect(JSON.stringify(s)).not.toContain("NaN");
    }
  });
});
