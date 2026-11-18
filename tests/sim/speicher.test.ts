/**
 * Speichern und Laden über den GESAMTEN Zustand (ADR 0019), ohne Liste einzelner Felder: Neue Zustandsfelder anderer
 * Zweige sind damit automatisch abgedeckt.
 *
 * 1. Ein datengetriebener Treiber spielt eine Partie (alle baubaren Gebäude aus BUILDINGS, alle Rezepte, alle Techniken,
 *    alle Einheiten der Ausbildungsstätten, Mauern, Überfälle, Befehle, Abriss, Abbrüche). Neue Gebäude, Rezepte und
 *    Einheiten aus den Daten kommen so ohne Änderung an diesem Test vor.
 * 2. An vielen Stellen: Zustand und Meta müssen reines JSON sein (keine Map, kein Set, keine Klasse, kein NaN, kein
 *    undefined in Listen, kein geteiltes Objekt), speichern, laden, und beide Partien laufen mit denselben Befehlen
 *    weiter. Der gesamte gespeicherte Baum muss dabei gleich bleiben; bei Abweichung nennt der Test die Pfade.
 * 3. World und Simulation dürfen keine neuen Felder außerhalb von Zustand und Meta tragen (sie gingen beim Speichern
 *    verloren); abgeleitete Strukturen stehen in DERIVED.
 */
import { describe, expect, it } from "vitest";
import { BUILDINGS, DIFFICULTY_KEYS, RECIPES, TECHS, type BuildingKey, type DifficultyKey, type RecipeKey, type TechKey } from "../../src/data";
import { createGame, loadGame } from "../../src/sim";
import { isSoldier } from "../../src/sim/combat";
import { buildNow, run, spawn, stockUp } from "../../src/sim/debug";
import type { Simulation } from "../../src/sim/game";
import { migrate, type SaveData } from "../../src/sim/migrate";
import type { Command } from "../../src/sim/types";
import { SAVE_VERSION, TPS, World } from "../../src/sim/world";
import { findSpot, lagerOf } from "./helpers";

// ---------------------------------------------------------------- Prüfhilfen
/**
 * Geteilte Objekte, die nur gelesen werden: Pfade aus dem Pfad-Cache (nav.ts) teilen sich mehrere Figuren; niemand
 * verändert sie, nach dem Laden sind es gleiche Kopien.
 */
const SHARED_OK = [/\.ai\.path$/];

/** Wege im Baum, die kein reines JSON sind oder ein Objekt mit einer anderen Stelle teilen. */
export function notJson(root: unknown, label = "state"): string[] {
  const bad: string[] = [];
  const seen = new Map<object, string>();
  const walk = (v: unknown, path: string, inArray: boolean) => {
    if (bad.length > 20) return;
    if (v === null || typeof v === "string" || typeof v === "boolean") return;
    if (v === undefined) { if (inArray) bad.push(`${path}: undefined in einer Liste (wird null)`); return; }
    if (typeof v === "number") { if (!Number.isFinite(v)) bad.push(`${path}: ${v}`); return; }
    if (typeof v !== "object") { bad.push(`${path}: ${typeof v}`); return; }
    const prev = seen.get(v);
    if (prev && SHARED_OK.some((re) => re.test(path) && re.test(prev))) return;
    if (prev) { bad.push(`${path}: dasselbe Objekt wie ${prev} (nach dem Laden zwei Kopien)`); return; }
    seen.set(v, path);
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`, true)); return; }
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) { bad.push(`${path}: ${proto?.constructor?.name ?? "Klasse"} statt reinem Objekt`); return; }
    for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k], `${path}.${k}`, false);
  };
  walk(root, label, false);
  return bad;
}

/** Erste abweichende Pfade zweier JSON-Bäume (für eine lesbare Fehlermeldung). */
export function diffPaths(a: unknown, b: unknown, path = "", out: string[] = []): string[] {
  if (out.length >= 8) return out;
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b) || (a === null) !== (b === null)) {
    out.push(`${path}: ${JSON.stringify(a)?.slice(0, 80)} ≠ ${JSON.stringify(b)?.slice(0, 80)}`);
    return out;
  }
  if (a && typeof a === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b as object)]);
    for (const k of keys) diffPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, out);
    return out;
  }
  if (a !== b) out.push(`${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
  return out;
}

function expectSame(g: Simulation, h: Simulation, when: string): void {
  const a = g.save(), b = h.save();
  if (a === b) return;
  const d = diffPaths(JSON.parse(a), JSON.parse(b));
  expect.fail(`${when}: Spielstände weichen ab:\n${d.join("\n")}`);
}

/** Abgeleitete Felder von World (baut der Konstruktor aus Zustand und Meta neu auf); alles andere gehört in s oder meta. */
const DERIVED = new Set(["s", "meta", "nav", "grid", "units", "buildings", "budget"]);

// ---------------------------------------------------------------- Treiber
const PLACEABLE = (Object.keys(BUILDINGS) as BuildingKey[]).filter((k) => !BUILDINGS[k].seat && k !== "mauer");
const TECH_KEYS = Object.keys(TECHS) as TechKey[];
const RECIPE_KEYS = Object.keys(RECIPES) as RecipeKey[];

/**
 * Aufstellung für den Treiber: von jedem baubaren Gebäude aus den Daten eines fertig in Lagernähe (wo die Regeln es
 * erlauben), dazu neun Soldaten und je Arbeitsplatz der gesetzten Gebäude ein weiterer Tagelöhner. So laufen Gewinnung,
 * Verarbeitung, Ausbildung und Verteidigung von Beginn an, und es bleiben Tagelöhner zum Tragen, Bauen und Ausbilden,
 * auch wenn die Daten mehr Werkstätten bekommen (sonst nähmen die Arbeitsplätze alle Tagelöhner der Startaufstellung).
 */
function setup(g: Simulation): void {
  const l = lagerOf(g);
  let jobs = 0;
  for (const key of PLACEABLE) {
    try { const [x, y] = findSpot(g, key, l.x + 2, l.y - 4, 0, 26); buildNow(g, key, x, y, 0); jobs += BUILDINGS[key].workers?.count ?? 0; } catch { /* kein Platz auf dieser Karte */ }
  }
  for (let i = 0; i < jobs; i++) spawn(g, "tageloehner", 0, l.x - 3 + (i % 4), l.y + 3 + Math.floor(i / 4));
  const keys = ["speer", "schwert", "bogen"] as const;
  for (let i = 0; i < 9; i++) spawn(g, keys[i % 3], 0, l.x + 2 + (i % 3), l.y + 3 + Math.floor(i / 3));
}

/** Spielt mit eigenem Zufall: zwei Treiber mit demselben Stand geben zwei gleichen Partien dieselben Befehle. */
class Driver {
  constructor(public r: number) {}
  clone(): Driver { return new Driver(this.r); }
  rnd(): number { this.r = (this.r * 1103515245 + 12345) & 0x7fffffff; return this.r / 0x7fffffff; }
  pick<T>(a: readonly T[]): T { return a[Math.floor(this.rnd() * a.length)]; }

  /** Ein Tick: ab und zu ein Befehl, dann g.tick(). */
  step(g: Simulation): void {
    const s = g.state;
    if (s.tick % TPS === 0) this.second(g);
    g.tick();
  }

  private send(g: Simulation, c: Command): void { g.dispatch(c); }

  private second(g: Simulation): void {
    const s = g.state, sec = s.tick / TPS;
    const own = s.buildings.filter((b) => b.team === 0);
    const lager = s.buildings.find((b) => b.key === "lager") ?? own[0];
    if (sec % 60 === 0) { stockUp(g, "holz", 30); stockUp(g, "stein", 30); stockUp(g, "getreide", 10); }
    const sites = own.filter((b) => b.built < 1).length;
    if (sec % 15 === 0 && lager && sites < 3) {
      const key = this.pick(PLACEABLE);
      for (let k = 0; k < 30; k++) {
        const x = lager.x - 16 + Math.floor(this.rnd() * 32), y = lager.y - 18 + Math.floor(this.rnd() * 30);
        if (g.dispatch({ t: "bauen", key, x, y, o: Math.floor(this.rnd() * 4) }).ok) break;
      }
    }
    if (sec % 40 === 0 && lager) {
      const x = lager.x + 6 + Math.floor(this.rnd() * 8), y = lager.y - 6 + Math.floor(this.rnd() * 10);
      this.send(g, { t: "mauer", x0: x, y0: y, x1: x + Math.floor(this.rnd() * 5), y1: y + Math.floor(this.rnd() * 5) });
    }
    if (sec % 5 === 0) {
      for (const b of own) {
        const def = BUILDINGS[b.key];
        if (def.trains && b.built >= 1) {
          // sparsam: jeder Rekrut ist ein Tagelöhner weniger für Tragen und Bauen
          if (sec % 30 === 0 && this.rnd() < 0.6) this.send(g, { t: "rekrutieren", building: b.id, unit: this.pick(def.trains) });
          if (this.rnd() < 0.12 && b.queue.length) this.send(g, { t: "ausbildung_abbrechen", building: b.id, index: Math.floor(this.rnd() * b.queue.length) });
          if (this.rnd() < 0.05 && b.training) this.send(g, { t: "ausbildung_abbrechen", building: b.id, index: -1 });
        }
        if (b.proc && this.rnd() < 0.2) {
          const recipes = RECIPE_KEYS.filter((r) => RECIPES[r].building === b.key);
          if (recipes.length && this.rnd() < 0.5) this.send(g, { t: "rezept", building: b.id, recipe: this.pick(recipes) });
          else this.send(g, { t: "produktion", building: b.id, an: this.rnd() < 0.7 });
        }
        if (def.seat && this.rnd() < 0.1) this.send(g, { t: "ausbauen", building: b.id });
      }
    }
    if (sec % 20 === 0) {
      if (this.rnd() < 0.8) this.send(g, { t: "forschen", tech: this.pick(TECH_KEYS) });
      else this.send(g, { t: "forschung_abbrechen" });
    }
    if (sec % 7 === 0) {
      const soldiers = s.units.filter((u) => u.team === 0 && !u.dead && isSoldier(u.key)).map((u) => u.id);
      const foe = s.units.find((u) => u.team === 1 && !u.dead);
      if (soldiers.length) {
        const r = this.rnd();
        if (r < 0.35) this.send(g, { t: "stationieren", units: soldiers });
        else if (r < 0.55) this.send(g, { t: "halten", units: soldiers.slice(0, 2) });
        else if (r < 0.75 && foe) this.send(g, { t: "angreifen", units: soldiers, target: foe.id });
        else if (lager) this.send(g, { t: "bewegen", units: soldiers, x: lager.x + Math.floor(this.rnd() * 10) - 5, y: lager.y + 4 });
      }
    }
    if (sec === 150) this.send(g, { t: "ueberfall" }); // dazu die regulären Wellen
    if (sec % 150 === 0 && own.length > 6) {
      const b = this.pick(own.filter((x) => !BUILDINGS[x.key].seat));
      if (b) this.send(g, { t: "abreissen", id: b.id });
    }
  }
}

/**
 * Spielt `seconds` Spielsekunden und prüft alle `every` Sekunden die Rundreise: Das Original und seine geladene Kopie
 * laufen `cont` Ticks mit denselben Befehlen weiter (zählt zur Spielzeit). Gibt die Zahl der Prüfungen zurück.
 */
function roundTrips(g: Simulation, d: Driver, seconds: number, every: number, cont: number): number {
  let checks = 0;
  const end = g.state.tick + seconds * TPS;
  let next = g.state.tick + every * TPS;
  while (g.state.tick < end) {
    d.step(g);
    if (g.state.tick < next) continue;
    next += every * TPS;
    const when = `${(g.state.tick / TPS).toFixed(1)} s`;
    const bad = [...notJson(g.world.s, "state"), ...notJson(g.world.meta, "meta")];
    expect(bad, `Zustand nach ${when} ist kein reines JSON`).toEqual([]);
    const own = Object.keys(g.world).filter((k) => !DERIVED.has(k));
    expect(own, "World trägt Felder außerhalb von Zustand und Meta").toEqual([]);
    expect(Object.keys(g)).toEqual(["world"]);
    const json = g.save();
    const h = loadGame(json);
    expect(h.save(), `sofort nach dem Laden (${when})`).toBe(json);
    const dh = d.clone();
    for (let t = 0; t < cont; t++) {
      d.step(g); dh.step(h);
      if (t % 40 === 39) expectSame(g, h, `${when} + ${t + 1} Ticks`);
    }
    expectSame(g, h, `${when} + ${cont} Ticks`);
    checks++;
  }
  return checks;
}

describe("Speichern: Rundreise über den gesamten Zustand", () => {
  it.each([
    [1, "normal"], [7, "schwer"], [23, "leicht"],
  ] as [number, DifficultyKey][])("Seed %i, %s: 8 Spielminuten mit allen Gebäuden, Rezepten, Techniken und Überfällen", (seed, difficulty) => {
    const g = createGame({ seed, difficulty });
    setup(g);
    const d = new Driver(seed * 7919);
    const n = roundTrips(g, d, 8 * 60, 30, 160);
    expect(n).toBe(16);
    const s = g.state;
    console.log(`Rundreise Seed ${seed} (${difficulty}): Tick ${s.tick}, ${s.buildings.length} Gebäude (${[...new Set(s.buildings.map((b) => b.key))].join(",")}), ${s.units.length} Figuren, Welle ${s.raid.wave}, Ausgang ${s.outcome ?? "offen"}, Statistik ${JSON.stringify(s.match.stats)}`);
    // der Treiber hat wirklich gespielt: gebaut bzw. ausgebildet und gekämpft
    expect(s.raid.wave).toBeGreaterThan(1);
    const st = s.match.stats;
    expect(st.built + st.trained).toBeGreaterThan(0);
    expect(st.kills).toBeGreaterThan(0);
  }, 60000);

  it("das Original läuft nach dem Speichern genauso weiter wie die geladene Kopie (ohne erneutes Laden)", () => {
    const g = createGame({ seed: 5 });
    setup(g);
    const d = new Driver(99);
    for (let i = 0; i < 150 * TPS; i++) d.step(g);
    const h = loadGame(g.save());
    const dh = d.clone();
    for (let i = 0; i < 60 * TPS; i++) { d.step(g); dh.step(h); }
    expectSame(g, h, "150 s + 60 s");
  }, 30000);

  it("nach Sieg und nach Niederlage bleibt die Rundreise gleich", () => {
    const g = createGame({ seed: 2 });
    g.state.match.stats.waves = 5;
    run(g, 2);
    expect(g.state.outcome).toBe("sieg");
    const h = loadGame(g.save());
    run(g, 200); run(h, 200);
    expectSame(g, h, "nach dem Sieg");
    expect(h.state.outcome).toBe("sieg");

    const k = createGame({ seed: 2 });
    const seat = k.state.buildings.find((b) => BUILDINGS[b.key].seat)!;
    k.dispatch({ t: "ueberfall" });
    seat.hp = 1;
    run(k, 120 * TPS, () => k.state.outcome === "niederlage");
    expect(k.state.outcome).toBe("niederlage");
    const m = loadGame(k.save());
    run(k, 200); run(m, 200);
    expectSame(k, m, "nach der Niederlage");
  }, 30000);

  it("Pfade aus dem Pfad-Cache werden nie verändert (darum dürfen Figuren sie teilen)", async () => {
    const src = (await import("../../src/sim/nav.ts?raw")).default + (await import("../../src/sim/move.ts?raw")).default;
    expect(src).not.toMatch(/path\.(push|splice|pop|shift|unshift|reverse|sort|fill)\(/);
    expect(src).not.toMatch(/path\[[^\]]*\]\s*=[^=]/);
  });

  it("die Prüfhilfe findet nicht speicherbare Felder", () => {
    const s = { a: new Map(), b: [1, undefined], c: NaN, d: { x: 1 }, e: null as unknown, f: new Set() };
    s.e = s.d;
    const bad = notJson(s);
    expect(bad.join("\n")).toMatch(/state\.a: Map/);
    expect(bad.join("\n")).toMatch(/state\.b\[1\]: undefined/);
    expect(bad.join("\n")).toMatch(/state\.c: NaN/);
    expect(bad.join("\n")).toMatch(/state\.e: dasselbe Objekt wie state\.d/);
    expect(bad.join("\n")).toMatch(/state\.f: Set/);
    expect(notJson(createGame({ seed: 1 }).world.s)).toEqual([]);
  });

  it("die Prüfhilfe meldet ein neues Feld an World", () => {
    const g = createGame({ seed: 1 });
    expect(Object.keys(g.world).filter((k) => !DERIVED.has(k))).toEqual([]);
    expect(g.world).toBeInstanceOf(World);
  });
});

describe("Spielstand-Versionen", () => {
  it("ein Stand der Version 2 (ohne Partie) wird auf die aktuelle Version gehoben und spielt gleich weiter", () => {
    const g = createGame({ seed: 4 });
    const l = lagerOf(g);
    g.dispatch({ t: "bauen", key: "haus", x: l.x + 2, y: l.y + 5, o: 0 });
    run(g, 40 * TPS);
    const d = JSON.parse(g.save()) as SaveData;
    const tutorial = g.state.match.tutorial;
    delete (d.state as Partial<SaveData["state"]>).match;
    d.v = 2;
    const h = loadGame(JSON.stringify(d));
    expect(h.state.match.scenario).toBe("tal");
    expect(h.state.match.difficulty).toBe("normal");
    expect(h.state.match.tutorial).toBe(tutorial);
    expect(JSON.parse(h.save()).v).toBe(SAVE_VERSION);
  });

  it("lehnt Version 1, unbekannte neuere Versionen und Unsinn mit Meldung ab", () => {
    const d = JSON.parse(createGame({ seed: 1 }).save()) as SaveData;
    expect(() => loadGame(JSON.stringify({ ...d, v: 1 }))).toThrow(/älteren Version/);
    expect(() => loadGame(JSON.stringify({ ...d, v: SAVE_VERSION + 1 }))).toThrow(/neuer als dieses Spiel/);
    expect(() => loadGame("{kaputt")).toThrow(/beschädigt/);
    expect(() => loadGame("{}")).toThrow(/Kein gültiger Spielstand/);
    expect(() => migrate({ v: 3 } as SaveData, 3)).toThrow();
  });

  it("restore() tauscht die Partie aus, ohne die Simulation zu ersetzen", () => {
    const a = createGame({ seed: 1, difficulty: "leicht" });
    run(a, 30 * TPS);
    const json = a.save();
    const b = createGame({ seed: 9 });
    const ref = b;
    b.restore(json);
    expect(ref).toBe(b);
    expect(b.state.seed).toBe(1);
    expect(b.save()).toBe(json);
    run(a, 100); run(b, 100);
    expectSame(a, b, "nach restore");
  });

  it("alle Schwierigkeitsgrade lassen sich speichern und laden", () => {
    for (const diff of DIFFICULTY_KEYS) {
      const g = createGame({ seed: 3, difficulty: diff });
      run(g, 10 * TPS);
      expect(loadGame(g.save()).state.match.difficulty).toBe(diff);
    }
  });
});
