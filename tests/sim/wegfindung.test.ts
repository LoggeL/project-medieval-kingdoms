/**
 * Wegfindung (ADR 0010): Gebäude, auch Lagerhaus, Bergfried (alle Stufen) und Baustellen, sind echte Hindernisse.
 *
 * Die Prüfungen rechnen „fest“ unabhängig vom Laufraster aus den Grundrissen nach (geom + Daten), damit ein Fehler im
 * Laufraster selbst auffällt: Ein Gebäude belegt seinen ganzen Grundriss, begehbar bleiben nur eine Tür im Grundriss
 * (offene Einfahrt, zurzeit bei keinem Gebäude), das Tor (nur für eigene Leute) und der untere Treppen-Tile; der obere
 * Treppen-Tile gehört zur Laufebene des Wehrgangs. Ins Lagerhaus gehen Träger nur durchs Tor (storeVisit, ADR 0005);
 * drinnen (Unit.inside) sind sie im Grundriss, das ist gewollt.
 */
import { describe, expect, it } from "vitest";
import { BUILDINGS, type BuildingKey, type UnitKey } from "../../src/data";
import { createGame } from "../../src/sim";
import { buildNow, spawn, stockUp } from "../../src/sim/debug";
import type { Simulation } from "../../src/sim/game";
import { approach, doorInside, entrance, footprint, footprintTiles, stairEnds } from "../../src/sim/geom";
import { storeVisit, walkOut } from "../../src/sim/jobs";
import { goalEntrance, tileGoal } from "../../src/sim/move";
import type { Team } from "../../src/sim/types";
import { TPS, type SBuilding, type SUnit, type World } from "../../src/sim/world";
import { lagerOf } from "./helpers";

// Wege und Brücken (BuildingDef.road) sind keine Hindernisse, sondern Laufflächen: Sie prüft tests/sim/transport-wege.test.ts.
const KEYS = (Object.keys(BUILDINGS) as BuildingKey[]).filter((k) => !BUILDINGS[k].road);
const worldOf = (g: Simulation): World => (g as unknown as { world: World }).world;

/** Feste Tiles am Boden je Team: Tile-Index → Gebäude. */
function solidMap(g: Simulation, team: Team): Map<number, SBuilding> {
  const s = g.state, out = new Map<number, SBuilding>();
  for (const b of s.buildings as SBuilding[]) {
    const done = b.built >= 1, def = BUILDINGS[b.key];
    const [dx, dy] = entrance(b.key, b.x, b.y, b.o);
    const st = def.stairs ? stairEnds(b.x, b.y, b.o) : null;
    for (const [x, y] of footprintTiles(b.key, b.x, b.y, b.o)) {
      if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
      if (done) {
        if (x === dx && y === dy && doorInside(b.key, b.x, b.y, b.o)) continue; // Einfahrt
        if (def.gate && team === 0) continue; // Tor: offen für eigene Leute
        if (st && x === st.bottom[0] && y === st.bottom[1]) continue; // Fuß der Treppe
      }
      out.set(y * s.w + x, b);
    }
  }
  return out;
}

/**
 * Prüft einen Weg (Knotenliste ab Start): kein Knoten am Boden auf einem festen Tile (außer im Belagerungsmodus, dort
 * führt der Weg absichtlich durch das einzureißende Gebäude) und keine Diagonale an einer festen Ecke vorbei.
 */
function checkRoute(g: Simulation, team: Team, breach: boolean, start: number, path: number[], label: string): string[] {
  const nav = worldOf(g).nav, W = g.state.w;
  const solid = solidMap(g, team);
  const errs: string[] = [];
  let prev = start;
  for (const n of path) {
    const l = nav.layerOf(n), x = nav.tileX(n), y = nav.tileY(n);
    if (l === 0 && !breach && solid.has(y * W + x)) errs.push(`${label}: Knoten (${x},${y}) liegt in ${solid.get(y * W + x)!.key}`);
    const pl = nav.layerOf(prev), px = nav.tileX(prev), py = nav.tileY(prev);
    if (l === 0 && pl === 0) {
      const ddx = x - px, ddy = y - py;
      if (Math.abs(ddx) > 1 || Math.abs(ddy) > 1) errs.push(`${label}: Sprung (${px},${py})→(${x},${y})`);
      if (ddx !== 0 && ddy !== 0 && (solid.has(py * W + x) || solid.has(y * W + px)))
        errs.push(`${label}: Diagonale (${px},${py})→(${x},${y}) schneidet eine feste Ecke`);
    }
    prev = n;
  }
  return errs;
}

/** Test-Welt: leere Wiese mit einem fertigen Gebäude (Treppe mit Mauer dahinter, Tor in einer Mauerlinie), level = Ausbaustufe. */
function place(key: BuildingKey, o: number, level = 1): { g: Simulation; b: SBuilding } {
  const g = createGame({ scenario: "leer", size: 32, raids: false });
  const x = 14, y = 14;
  if (key === "treppe") {
    const e = stairEnds(x, y, o);
    buildNow(g, "mauer", e.wall[0], e.wall[1]);
  }
  if (key === "tor") {
    const along: [number, number] = o % 2 === 0 ? [1, 0] : [0, 1];
    buildNow(g, "mauer", x - along[0], y - along[1]);
    buildNow(g, "mauer", x + along[0], y + along[1]);
  }
  const b = buildNow(g, key, x, y, o) as SBuilding;
  if (level > 1) { b.level = level; worldOf(g).nav.rebuild(); }
  return { g, b };
}

/** Ring von Tiles im Abstand r um den Grundriss. */
function ring(b: SBuilding, r: number): [number, number][] {
  const [w, h] = footprint(b.key, b.o);
  const out: [number, number][] = [];
  for (let y = b.y - r; y <= b.y + h - 1 + r; y++) for (let x = b.x - r; x <= b.x + w - 1 + r; x++) {
    if (Math.max(b.x - x, 0, x - (b.x + w - 1)) === r || Math.max(b.y - y, 0, y - (b.y + h - 1)) === r) out.push([x, y]);
  }
  return out;
}

/** Alle Gebäude × Ausbaustufen (Bergfried: Holz, Stein mit Wehrplattform, Burgfried). */
const VARIANTS: [BuildingKey, number][] = KEYS.flatMap((k) => (BUILDINGS[k].levels ?? [null]).map((_, i) => [k, i + 1] as [BuildingKey, number]));

describe("Wegfindung um Gebäude", () => {
  it("prüft alle Gebäude der Daten, den Bergfried in allen Stufen", () => {
    expect(KEYS).toContain("bergfried");
    expect(KEYS).toContain("lager");
    expect(VARIANTS.filter(([k]) => k === "bergfried").map(([, l]) => l)).toEqual([1, 2, 3]);
  });
  for (const [key, level] of VARIANTS) for (let o = 0; o < 4; o++) {
    const name = level > 1 ? `${key} Stufe ${level}` : key;
    it(`${name}, Ausrichtung ${o}: kein Weg durch den Grundriss oder an Ecken vorbei (beide Teams, auch Belagerung)`, () => {
      const { g, b } = place(key, o, level);
      const nav = worldOf(g).nav;
      const starts = [...ring(b, 1), ...ring(b, 2)].filter(([x, y]) => nav.open(nav.node(0, x, y), 0));
      const targets = ring(b, 2);
      const errs: string[] = [];
      let routes = 0;
      for (const [team, breach] of [[0, false], [1, false], [1, true]] as [Team, boolean][]) {
        for (const [sx, sy] of starts) {
          const from = nav.node(0, sx, sy);
          if (nav.pass(from, team, breach) < 0) continue;
          for (const [tx, ty] of targets) {
            const p = nav.route(team, breach, from, tileGoal(tx, ty));
            if (!p) continue;
            routes++;
            errs.push(...checkRoute(g, team, breach, from, p, `T${team}${breach ? "b" : ""} (${sx},${sy})→(${tx},${ty})`));
          }
        }
      }
      expect(routes).toBeGreaterThan(50);
      expect(errs.slice(0, 5)).toEqual([]);
    });

    if (BUILDINGS[key].door || BUILDINGS[key].storage || BUILDINGS[key].workers) {
      it(`${name}, Ausrichtung ${o}: Zugang nur über die Tür (Daten door)`, () => {
        const { g, b } = place(key, o, level);
        const nav = worldOf(g).nav;
        const [ex, ey] = entrance(b.key, b.x, b.y, b.o), [ax, ay] = approach(b.key, b.x, b.y, b.o);
        const goal = goalEntrance(worldOf(g), b);
        expect([goal.x0, goal.y0, goal.d]).toEqual([ex, ey, 0]);
        for (const [sx, sy] of ring(b, 3)) {
          const from = nav.node(0, sx, sy);
          const p = nav.route(0, false, from, goal);
          expect(p, `Tür von (${sx},${sy}) erreichbar`).not.toBeNull();
          expect(checkRoute(g, 0, false, from, p!, "Tür")).toEqual([]);
          if (doorInside(b.key, b.x, b.y, b.o)) {
            // in die Einfahrt nur gerade vom Vorplatz aus
            const before = p!.length >= 2 ? p![p!.length - 2] : from;
            expect([nav.tileX(before), nav.tileY(before)]).toEqual([ax, ay]);
          }
        }
      });
    }
  }

  it("keine Diagonale zwischen zwei Gebäuden, die sich nur an einer Ecke berühren (auch nicht für Angreifer)", () => {
    const g = createGame({ scenario: "leer", size: 32, raids: false });
    buildNow(g, "haus", 10, 10); // belegt 10..11 × 10..11
    buildNow(g, "haus", 12, 12); // berührt das erste nur an der Ecke (12,12)/(11,11)
    const nav = worldOf(g).nav;
    for (const [team, breach] of [[0, false], [1, false], [1, true]] as [Team, boolean][]) {
      const from = nav.node(0, 12, 11), goal = tileGoal(11, 12);
      const p = nav.route(team, breach, from, goal)!;
      expect(p).not.toBeNull();
      expect(checkRoute(g, team, breach, from, p, "Ecke")).toEqual([]);
      if (!breach) expect(p.length).toBeGreaterThan(2); // Umweg statt Abkürzung durch die Ecke
    }
  });

  it("Lagerhaus: Träger holen und bringen nur durchs Tor, außen nie im Grundriss (alle Ausrichtungen, alle Fächer)", () => {
    for (let o = 0; o < 4; o++) {
      const g = createGame({ scenario: "leer", size: 32, raids: false });
      const l = buildNow(g, "lager", 14, 14, o) as SBuilding;
      const w = worldOf(g);
      const [ex, ey] = entrance("lager", l.x, l.y, o);
      const fp = new Set(footprintTiles("lager", l.x, l.y, o).map(([x, y]) => y * 32 + x));
      expect(fp.has(ey * 32 + ex)).toBe(false);
      for (let k = 0; k < 8; k++) {
        const u = spawn(g, "tageloehner", 0, l.x + 6, l.y + 5) as SUnit;
        let r = "", lastOut: [number, number] | null = null, entered = false;
        const tileOf = (): number => Math.floor(u.y) * 32 + Math.floor(u.x);
        for (let t = 0; t < 60 * TPS && r !== "arrived"; t++) {
          r = storeVisit(w, u, l, k);
          const inFp = fp.has(tileOf());
          // im Grundriss nur als „drinnen“ (durchs Tor eingetreten), nie von außen über die Wand
          expect(!inFp || u.inside === l.id, `Fach ${k}, o ${o}: außen im Grundriss bei (${u.x.toFixed(2)},${u.y.toFixed(2)})`).toBe(true);
          if (inFp && !entered) { entered = true; expect(lastOut, `Fach ${k}, o ${o}: Eintritt nicht vom Tor`).toEqual([ex, ey]); }
          if (!inFp) lastOut = [Math.floor(u.x), Math.floor(u.y)];
        }
        expect(r).toBe("arrived");
        expect(entered).toBe(true);
        expect(fp.has(tileOf())).toBe(true);
        // hinaus: derselbe Weg zurück bis vor das Tor
        for (let t = 0; t < 30 * TPS && walkOut(w, u); t++) expect(fp.has(tileOf()) || [Math.floor(u.x), Math.floor(u.y)].join() === [ex, ey].join()).toBe(true);
        expect(u.inside).toBeUndefined();
        expect([Math.floor(u.x), Math.floor(u.y)]).toEqual([ex, ey]);
        w.removeUnit(u);
      }
    }
  });

  it("nichts vor eine Tür bauen, auch keine Mauer", () => {
    const g = createGame({ scenario: "leer", size: 32, raids: false });
    buildNow(g, "lager", 2, 2, 0);
    stockUp(g, "holz", 100); stockUp(g, "stein", 100);
    const h = buildNow(g, "haus", 10, 10, 0);
    const [ex, ey] = entrance("haus", h.x, h.y, h.o);
    const r = g.canPlace("mauer", ex, ey, 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("Eingang");
    expect(g.wallPath(ex - 2, ey, ex + 2, ey).ok).toBe(false);
    const l = buildNow(g, "lager", 20, 10, 0);
    const [ax, ay] = approach("lager", l.x, l.y, l.o);
    expect(g.canPlace("haus", ax, ay, 0).ok).toBe(false);
    expect(g.canPlace("haus", ax + 1, ay + 1, 0).ok).toBe(true);
  });
});

// ---------------------------------------------------------------- Langzeit
describe("Langzeit: keine Figur steht in einem Gebäude, Bergfried oder auf einer Baustelle", () => {
  it.each([1, 11])("Standardspiel Seed %i, 9000 Ticks mit Bauen, Rekruten, Mauern und Überfällen", (seed) => {
    const g = createGame({ seed, raids: true });
    const w = worldOf(g), W = g.state.w;
    const l = lagerOf(g);
    let r = seed * 7919 + 1;
    const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const keys: BuildingKey[] = ["holzfaeller", "steinbruch", "haus", "kaserne", "lager", "turm", "treppe", "haus", "holzfaeller"];
    const units: UnitKey[] = ["speer", "schwert", "bogen"];
    stockUp(g, "holz", 80); stockUp(g, "stein", 80); stockUp(g, "speer", 6); stockUp(g, "bogen", 6);
    // eine kleine Wache, damit die Überfälle die Siedlung nicht schleifen (es geht um die Wege, nicht um die Balance)
    for (let i = 0; i < 6; i++) spawn(g, (["schwert", "bogen", "speer"] as UnitKey[])[i % 3], 0, l.x + 4 + (i % 3), l.y + 4 + Math.floor(i / 3));
    const errs: string[] = [];
    let checks = 0, version = -1;
    let solid: [Map<number, SBuilding>, Map<number, SBuilding>] = [new Map(), new Map()];
    for (let tick = 1; tick <= 9000; tick++) {
      if (tick % (8 * TPS) === 0) {
        const key = keys[Math.floor(rnd() * keys.length)];
        for (let k = 0; k < 40; k++) {
          const x = l.x - 12 + Math.floor(rnd() * 24), y = l.y - 14 + Math.floor(rnd() * 22);
          if (g.dispatch({ t: "bauen", key, x, y, o: Math.floor(rnd() * 4) }).ok) break;
        }
        if (tick % (40 * TPS) === 0) {
          const x = l.x + 4 + Math.floor(rnd() * 6), y = l.y - 8 + Math.floor(rnd() * 6);
          g.dispatch({ t: "mauer", x0: x, y0: y, x1: x + Math.floor(rnd() * 3), y1: y + 4 + Math.floor(rnd() * 4) });
        }
        const kas = g.state.buildings.find((b) => b.key === "kaserne" && b.built >= 1);
        if (kas) g.dispatch({ t: "rekrutieren", building: kas.id, unit: units[Math.floor(rnd() * 3)] });
        const soldiers = g.state.units.filter((u) => u.team === 0 && !u.dead && units.includes(u.key)).map((u) => u.id);
        if (soldiers.length && tick % (24 * TPS) === 0) {
          if (rnd() < 0.5) g.dispatch({ t: "stationieren", units: soldiers });
          else g.dispatch({ t: "bewegen", units: soldiers, x: l.x + Math.floor(rnd() * 8) - 4, y: l.y + Math.floor(rnd() * 8) - 4 });
        }
      }
      g.tick();
      if (w.meta.navVersion !== version) { version = w.meta.navVersion; solid = [solidMap(g, 0), solidMap(g, 1)]; }
      for (const u of g.state.units as SUnit[]) {
        // drinnen (Lagerhaus, durchs Tor eingetreten) ist gewollt im Grundriss; Eintritt und Austritt prüft der Lagerhaus-Test
        if (u.dead || u.layer !== 0 || u.z > 0.05 || u.inside) continue;
        const sm = solid[u.team];
        // Tor zählt für Angreifer als fest; dort stehen sie nur, wenn das Tor schon gefallen ist (dann gibt es es nicht mehr)
        const at = (x: number, y: number) => sm.get(Math.floor(y) * W + Math.floor(x));
        const steps = 8;
        let ox = Math.floor(u.px), oy = Math.floor(u.py);
        for (let i = 0; i <= steps; i++) {
          const x = u.px + ((u.x - u.px) * i) / steps, y = u.py + ((u.y - u.py) * i) / steps;
          const fx = Math.floor(x), fy = Math.floor(y);
          checks++;
          const b = at(x, y);
          if (b) { errs.push(`Tick ${g.state.tick}: ${u.key} (Team ${u.team}, ${u.activity}) bei (${x.toFixed(2)},${y.toFixed(2)}) in ${b.key}${b.built < 1 ? " (Baustelle)" : ""}`); break; }
          if (fx !== ox && fy !== oy && (sm.has(oy * W + fx) || sm.has(fy * W + ox))) {
            errs.push(`Tick ${g.state.tick}: ${u.key} (Team ${u.team}) schneidet die Ecke (${ox},${oy})→(${fx},${fy})`);
            break;
          }
          ox = fx; oy = fy;
        }
      }
    }
    console.log(`Langzeit Seed ${seed}: ${checks} Prüfungen, ${g.state.buildings.length} Gebäude (${g.state.buildings.filter((b) => b.built >= 1).map((b) => b.key).join(",")}), ${g.state.units.length} Figuren, Welle ${g.state.raid.wave}, ${errs.length} Verstöße${errs.length ? `, z. B. ${errs[0]}` : ""}`);
    expect(checks).toBeGreaterThan(100000);
    expect(g.state.buildings.filter((b) => b.built >= 1).length).toBeGreaterThan(4);
    expect(g.state.raid.wave).toBeGreaterThanOrEqual(1);
    expect(errs.slice(0, 8)).toEqual([]);
  }, 60000);
});
