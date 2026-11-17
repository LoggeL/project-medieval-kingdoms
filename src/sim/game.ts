/**
 * Die Simulation: Spielstart, Tick mit fester Systemreihenfolge, Befehle, Speichern und Laden.
 *
 * Reihenfolge je Tick: Vorposition merken → Raum-Raster → Bäume → Disponent (alle 10 Ticks) → Bevölkerung →
 * Überfälle → Ausbildung → Einheiten handeln (Startpunkt rotiert, damit das Pfadbudget gerecht verteilt wird)
 * → Abstand halten → Geschosse → Tote → Animationszeit → Lagerstatistik.
 */
import { GOODS, START, TUNING, type BuildingKey, type Good } from "../data";
import { canPlace, completeBuilding, placeSite, placeVoice, removeBuilding, walkLayerAt, wallPath } from "./build";
import { isSoldier, separate, updateDeaths, updateProjectiles } from "./combat";
import { DISPATCH_EVERY, dispatcher, idlePeasant, pruneWorkers, updatePopulation, updateTrees } from "./economy";
import { footprintTiles } from "./geom";
import { runJob, toPeasant } from "./jobs";
import { emptyMap, generateMap } from "./mapgen";
import { cmdAttack, cmdHold, cmdMove, cmdRecruit, cmdStation, soldierAct, updateTraining } from "./military";
import { raidTick, raiderAct, spawnWave } from "./raid";
import { nextRandom, seedState } from "./rng";
import { storeDirect, updateStock } from "./storage";
import { updateActivity, updateRecruits } from "./activity";
import type { Command, CommandResult, Game, PlacementCheck, SimState } from "./types";
import { PATH_BUDGET, SAVE_VERSION, TPS, World, type Meta, type SBuilding, type SState, type SUnit } from "./world";

export interface GameOptions {
  seed?: number;
  /** Kantenlänge der quadratischen Karte (Standard START.mapSize). */
  size?: number;
  /** "standard": Startkarte mit Lager und Tagelöhnern; "leer": leere Wiese ohne alles (Tests). */
  scenario?: "standard" | "leer";
  /** Überfälle nach Zeitplan (Standard: an im Szenario "standard"). */
  raids?: boolean;
}

export class Simulation implements Game {
  constructor(readonly world: World) {}
  get state(): SimState { return this.world.s; }
  tick(): void { step(this.world); }
  dispatch(cmd: Command): CommandResult { return runCommand(this.world, cmd); }
  canPlace(key: BuildingKey, x: number, y: number, o: number): PlacementCheck {
    const r = canPlace(this.world, key, Math.floor(x), Math.floor(y), o);
    return { ok: r.ok, reason: r.reason, tiles: r.tiles };
  }
  wallPath(x0: number, y0: number, x1: number, y1: number): PlacementCheck {
    const r = wallPath(this.world, Math.floor(x0), Math.floor(y0), Math.floor(x1), Math.floor(y1));
    return { ok: r.ok, reason: r.reason, tiles: r.tiles };
  }
  walkLayerAt(x: number, y: number): number { return walkLayerAt(this.world, Math.floor(x), Math.floor(y)); }
  save(): string { return JSON.stringify({ v: SAVE_VERSION, state: this.world.s, meta: this.world.meta }); }
}

export function createGame(opts: GameOptions = {}): Simulation {
  const seed = opts.seed ?? 1;
  const size = Math.max(24, Math.floor(opts.size ?? START.mapSize));
  const scenario = opts.scenario ?? "standard";
  const meta: Meta = {
    version: SAVE_VERSION, rng: seedState(seed), nextId: 1, navVersion: 0,
    nextImmigrant: TUNING.immigrantSeconds * TPS, throttle: {},
    camp: [0, 0], entry: [0, 0], raidSpawn: [0, 0],
    raidsEnabled: opts.raids ?? scenario === "standard", raidRunning: false, immigration: scenario === "standard",
  };
  const rand = () => nextRandom(meta);
  const map = scenario === "leer" ? emptyMap(size, size) : generateMap(size, size, rand, () => meta.nextId++);
  meta.camp = map.camp; meta.entry = map.entry; meta.raidSpawn = map.raidSpawn;
  const stock = Object.fromEntries(Object.keys(GOODS).map((g) => [g, 0])) as Record<Good, number>;
  const s: SState = {
    tick: 0, seed, w: size, h: size, tiles: map.tiles, trees: map.trees, rocks: map.rocks,
    buildings: [], units: [], projectiles: [], gold: START.gold, population: 0, housing: 0, stock, capacity: 0,
    raid: { next: START.raid.firstSeconds * TPS, wave: 0, active: false }, messages: [],
  };
  const w = new World(s, meta);
  if (scenario === "standard") {
    spawnBuilt(w, "lager", map.lager[0], map.lager[1], 0);
    for (const [g, n] of Object.entries(START.stock) as [Good, number][]) storeDirect(w, g, n);
    for (let i = 0; i < START.peasants; i++) {
      const a = (i / START.peasants) * Math.PI * 2;
      w.addUnit("tageloehner", 0, map.camp[0] + 0.5 + Math.cos(a) * 1.5, map.camp[1] + 0.5 + Math.sin(a) * 1.5);
    }
    s.messages = [];
    w.msg("Willkommen, Burgherr! Baue eine Holzfällerhütte am Waldrand und einen Steinbruch am Fels.", "info", undefined, 20, "willkommen");
  }
  updatePopulation(w);
  updateStock(w);
  for (const u of s.units) updateActivity(w, u);
  updateRecruits(w);
  return new Simulation(w);
}

/** Spielstand laden (aus Simulation.save()). Folge-Ticks sind identisch mit dem gespeicherten Spiel. */
export function loadGame(json: string): Simulation {
  const d = JSON.parse(json) as { v: number; state: SState; meta: Meta };
  if (d.v !== SAVE_VERSION) throw new Error(`Unbekannte Spielstand-Version ${d.v}`);
  return new Simulation(new World(d.state, d.meta, false));
}

/** Fertiges Gebäude ohne Baustelle setzen (Startlager, Tests). */
export function spawnBuilt(w: World, key: BuildingKey, x: number, y: number, o: number): SBuilding {
  const b = w.addBuilding(key, 0, x, y, o);
  for (const [tx, ty] of footprintTiles(key, x, y, o)) if (w.inMap(tx, ty)) w.s.tiles[w.idx(tx, ty)].building = b.id;
  const onFp = new Set(footprintTiles(key, x, y, o).map(([tx, ty]) => w.idx(tx, ty)));
  w.s.trees = w.s.trees.filter((t) => !onFp.has(w.idx(t.x, t.y)));
  const n = w.s.messages.length;
  completeBuilding(w, b);
  w.s.messages.length = n;
  return b;
}

// ---------------------------------------------------------------- Tick
export function step(w: World): void {
  const s = w.s;
  s.tick++;
  w.budget = PATH_BUDGET;
  for (const u of s.units) { u.px = u.x; u.py = u.y; u.pz = u.z; if (u.ai.cd > 0) u.ai.cd--; }
  w.grid.rebuild(s.units);
  updateTrees(w);
  if (s.tick % DISPATCH_EVERY === 0) { pruneWorkers(w); dispatcher(w); }
  updatePopulation(w);
  raidTick(w);
  updateTraining(w);
  const list = s.units.slice(), n = list.length, off = n ? (s.tick * 7) % n : 0;
  for (let i = 0; i < n; i++) {
    const u = list[(i + off) % n];
    if (u.dead || !w.units.has(u.id)) continue;
    act(w, u);
    updateActivity(w, u);
  }
  updateRecruits(w);
  separate(w);
  updateProjectiles(w);
  updateDeaths(w);
  for (const u of s.units) u.animT += 1 / TPS;
  updateStock(w);
}

function act(w: World, u: SUnit): void {
  if (u.team === 1) { raiderAct(w, u); return; }
  if (isSoldier(u.key)) { soldierAct(w, u); return; }
  if (u.ai.job) { runJob(w, u); return; }
  if (u.key !== "tageloehner") { toPeasant(w, u); return; }
  idlePeasant(w, u);
}

// ---------------------------------------------------------------- Befehle
export function runCommand(w: World, c: Command): CommandResult {
  switch (c.t) {
    case "bauen": {
      const x = Math.floor(c.x), y = Math.floor(c.y);
      const chk = canPlace(w, c.key, x, y, c.o);
      if (!chk.ok) return withVoice({ ok: false, reason: chk.reason }, placeVoice(chk));
      return { ok: true, ids: [placeSite(w, c.key, x, y, c.o).id] };
    }
    case "mauer": {
      // Dasselbe Ergebnis wie die Vorschau (wallPath): bei Hindernis nichts, sonst die bezahlbaren Stücke
      const p = wallPath(w, Math.floor(c.x0), Math.floor(c.y0), Math.floor(c.x1), Math.floor(c.y1));
      if (!p.ok) return withVoice({ ok: false, reason: p.reason }, p.costFail ? "zu_teuer" : "kein_platz");
      const ids = p.build.map(([x, y]) => placeSite(w, "mauer", x, y, 0).id);
      return p.reason ? { ok: true, ids, reason: p.reason, voice: "zu_teuer" } : { ok: true, ids };
    }
    case "abreissen": {
      const b = w.buildings.get(c.id);
      if (!b || b.team !== 0) return { ok: false, reason: "Kein eigenes Gebäude" };
      removeBuilding(w, b, "abriss");
      return { ok: true, ids: [c.id] };
    }
    case "rekrutieren": return cmdRecruit(w, c.building, c.unit);
    case "bewegen": return cmdMove(w, c.units, Math.floor(c.x), Math.floor(c.y));
    case "angreifen": return cmdAttack(w, c.units, c.target);
    case "stationieren": return cmdStation(w, c.units);
    case "halten": return cmdHold(w, c.units);
    case "ueberfall": return { ok: true, ids: spawnWave(w) };
  }
  return { ok: false, reason: "Unbekannter Befehl" };
}

function withVoice(r: CommandResult, voice: CommandResult["voice"]): CommandResult {
  if (voice) r.voice = voice;
  return r;
}
