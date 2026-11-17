/**
 * Tiere (BRIEF §2.1, §10; ADR 0016): Schafe, Kühe und Pferde weiden um ihren Weideplatz, Hirsche und Rehe ziehen durch
 * den Wald und fliehen vor Figuren, Krähen picken am Boden und fliegen auf, wenn jemand vorbeikommt.
 *
 * Tiere sind eigene Objekte (SimState.animals), keine Einheiten: sie stehen nicht im Raum-Raster, sperren keine Wege und
 * nehmen nicht am Kampf teil. Sie ziehen geradlinig über begehbares Gelände ohne Gebäude (kein A*: kurze Wege im
 * Streifgebiet, bei einem Hindernis wird ein neues Ziel gewählt). Alle Zufälle kommen aus einem eigenen Zufallsstrom
 * (meta.life.rng) und die IDs aus einem eigenen Bereich (ab LIFE_ID_BASE), damit Tiere und nachwachsende Bäume die
 * übrige Simulation (Zufall, IDs) nicht verschieben.
 *
 * Jagd-Schnittstelle für ein späteres Jägerhaus: findGame, reserveGame/releaseGame, killAnimal (bzw. damageAnimal) und
 * takeMeat (siehe ADR 0016, dort auch die Zusammenführung mit den Wildpunkten des Zweigs „nahrung“).
 */
import { ANIMALS, LIFE, TERRAIN, type AnimalAnim, type AnimalKey } from "../data";
import { nextRandom, seedState } from "./rng";
import type { Animal } from "./types";
import { TPS, type World } from "./world";

/** Erste ID für Tiere und nachwachsende Bäume (weit über den IDs der übrigen Simulation). */
export const LIFE_ID_BASE = 1_000_000;

export interface LifeMeta {
  /** Eigener Zufallsstrom (mulberry32-Zustand). */
  rng: number;
  nextId: number;
  /** Stehende Bäume beim Start: bis zu dieser Zahl sät der Wald nach. */
  trees0: number;
  /** Gewünschte Zahl je Tierart (Startbestand); fehlende kommen nach LIFE.animals.respawnSeconds wieder. */
  want: Partial<Record<AnimalKey, number>>;
  /** Tick der nächsten Nachzucht-Prüfung. */
  respawn: number;
}

export const lifeRand = (w: World): number => nextRandom(w.meta.life!);
const range = (w: World, [a, b]: [number, number]): number => a + lifeRand(w) * (b - a);

/** Zufallsstrom, ID-Bereich und (mit animals) die Start-Tiere anlegen. */
export function initLife(w: World, animals: boolean): void {
  w.meta.life = {
    rng: seedState(w.s.seed * 7919 + 13), nextId: LIFE_ID_BASE,
    trees0: w.s.trees.filter((t) => t.state === "stehend").length, want: {}, respawn: Math.round(LIFE.animals.respawnSeconds * TPS),
  };
  if (!animals) return;
  w.s.animals = [];
  const scale = Math.max(0.5, (w.s.w * w.s.h) / 4096);
  for (const key of Object.keys(ANIMALS) as AnimalKey[]) {
    const n = Math.max(1, Math.round(ANIMALS[key].groups * scale));
    for (let g = 0; g < n; g++) spawnGroup(w, key, 8);
    w.meta.life.want[key] = w.s.animals.filter((a) => a.key === key).length;
  }
}

/** Darf ein Tier auf diesem Feld stehen (begehbar, kein Gebäude)? */
export function passable(w: World, x: number, y: number): boolean {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (!w.inMap(tx, ty)) return false;
  const t = w.s.tiles[w.idx(tx, ty)];
  return TERRAIN[t.terrain].walkable && !t.building;
}

/** Passendes Gelände der Art, frei von Gebäuden und Felsbrocken. */
function suits(w: World, key: AnimalKey, x: number, y: number): boolean {
  if (!passable(w, x, y)) return false;
  const t = w.s.tiles[w.idx(Math.floor(x), Math.floor(y))];
  if (!ANIMALS[key].terrain.includes(t.terrain)) return false;
  return !w.s.rocks.some((r) => r.x === Math.floor(x) && r.y === Math.floor(y));
}

/** Abstand zur nächsten lebenden Figur (Siedlung meiden beim Ansiedeln). */
function nearestUnit(w: World, x: number, y: number): number {
  let best = Infinity;
  for (const u of w.s.units) if (!u.dead) best = Math.min(best, Math.hypot(u.x - x, u.y - y));
  for (const b of w.s.buildings) best = Math.min(best, Math.hypot(b.x + 1 - x, b.y + 1 - y));
  return best;
}

/** Eine Gruppe auf passendem Gelände ansiedeln, mindestens `away` Felder von Figuren und Gebäuden. */
export function spawnGroup(w: World, key: AnimalKey, away: number): Animal[] {
  const def = ANIMALS[key], s = w.s;
  const out: Animal[] = [];
  for (let tries = 0; tries < 300; tries++) {
    const x = Math.floor(lifeRand(w) * s.w), y = Math.floor(lifeRand(w) * s.h);
    if (!suits(w, key, x + 0.5, y + 0.5)) continue;
    if (nearestUnit(w, x, y) < (tries < 200 ? away : away / 2)) continue;
    const n = Math.round(range(w, [def.group[0], def.group[1] + 0.49]));
    for (let i = 0; i < n; i++) {
      let ax = x + 0.5, ay = y + 0.5;
      for (let k = 0; k < 8; k++) {
        const cx = x + 0.5 + (lifeRand(w) * 2 - 1) * 1.6, cy = y + 0.5 + (lifeRand(w) * 2 - 1) * 1.6;
        if (suits(w, key, cx, cy)) { ax = cx; ay = cy; break; }
      }
      const a: Animal = {
        id: w.meta.life!.nextId++, key, x: ax, y: ay, z: 0, px: ax, py: ay, pz: 0, fx: lifeRand(w) * 2 - 1, fy: lifeRand(w) * 2 - 1,
        anim: def.kind === "vogel" ? "picken" : "grasen", animT: lifeRand(w) * 3, hx: x + 0.5, hy: y + 0.5, tx: ax, ty: ay,
        mode: "ruht", t: Math.round(range(w, def.pause) * TPS), hp: def.game?.hp ?? 20, meat: 0, reservedBy: 0,
      };
      (s.animals ??= []).push(a);
      out.push(a);
    }
    break;
  }
  return out;
}

function setA(a: Animal, anim: AnimalAnim): void {
  if (a.anim !== anim) { a.anim = anim; a.animT = 0; }
}

/** Einen Schritt Richtung (tx, ty); false = Hindernis (fliegende Vögel kennen keins). */
function stepTo(w: World, a: Animal, tx: number, ty: number, speed: number, fly = false): boolean {
  const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
  if (d < 1e-6) return true;
  a.fx = dx; a.fy = dy;
  const st = Math.min(d, speed / TPS);
  const nx = a.x + (dx / d) * st, ny = a.y + (dy / d) * st;
  // aus einem Feld, das inzwischen bebaut ist, darf es immer heraus
  if (!fly && !passable(w, nx, ny) && passable(w, a.x, a.y)) return false;
  if (!w.inMap(Math.floor(nx), Math.floor(ny))) return false;
  a.x = nx; a.y = ny;
  return true;
}

/** Neues Wanderziel im Streifgebiet (auf passendem Gelände), sonst bleibt es stehen. */
function wander(w: World, a: Animal): void {
  const def = ANIMALS[a.key];
  for (let k = 0; k < 6; k++) {
    const ang = lifeRand(w) * Math.PI * 2, r = 1 + lifeRand(w) * def.roam;
    const x = a.hx + Math.cos(ang) * r, y = a.hy + Math.sin(ang) * r;
    if (suits(w, a.key, x, y)) { a.tx = x; a.ty = y; a.mode = "zieht"; a.t = Math.round((r / def.speed + 8) * TPS); return; }
  }
  rest(w, a);
}

function rest(w: World, a: Animal): void {
  const def = ANIMALS[a.key];
  a.mode = "ruht";
  a.t = Math.round(range(w, def.pause) * TPS);
  // Weidetiere und Wild grasen meist, stehen manchmal nur; Krähen picken
  setA(a, def.kind === "vogel" ? "picken" : lifeRand(w) < 0.75 ? "grasen" : "stehen");
}

/** Nächste lebende Figur im Umkreis r (beliebiges Team), sonst null. */
function scarer(w: World, a: Animal, r: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null, bd = r;
  w.grid.query(a.x, a.y, r, (u) => {
    if (u.dead || u.inside) return;
    const d = Math.hypot(u.x - a.x, u.y - a.y);
    if (d < bd) { bd = d; best = u; }
  });
  return best;
}

/** Wild flieht: Ziel weg von der Figur (bei Hindernis seitlich ausweichen). */
function flee(w: World, a: Animal, from: { x: number; y: number }): void {
  const dx = a.x - from.x, dy = a.y - from.y, d = Math.hypot(dx, dy) || 1;
  for (const turn of [0, 0.6, -0.6, 1.2, -1.2]) {
    const c = Math.cos(turn), s = Math.sin(turn);
    const ux = (dx / d) * c - (dy / d) * s, uy = (dx / d) * s + (dy / d) * c;
    const x = a.x + ux * 7, y = a.y + uy * 7;
    if (passable(w, a.x + ux, a.y + uy) && passable(w, x, y)) {
      a.tx = x; a.ty = y; a.mode = "flieht"; a.t = Math.round(LIFE.animals.fleeSeconds * TPS);
      setA(a, "rennen");
      return;
    }
  }
}

/** Krähe fliegt auf (und die Nachbarn im Schwarm mit), landet ein Stück weiter auf passendem Gelände. */
function takeOff(w: World, a: Animal, from: { x: number; y: number }): void {
  const def = ANIMALS[a.key];
  const dx = a.x - from.x, dy = a.y - from.y, d = Math.hypot(dx, dy) || 1;
  let tx = a.hx, ty = a.hy;
  for (let k = 0; k < 8; k++) {
    const ang = Math.atan2(dy / d, dx / d) + (lifeRand(w) * 2 - 1) * 1.2, r = range(w, LIFE.animals.flight);
    const x = a.x + Math.cos(ang) * r, y = a.y + Math.sin(ang) * r;
    if (suits(w, a.key, x, y) && !scarer(w, { ...a, x, y }, def.shy * 2)) { tx = x; ty = y; break; }
  }
  for (const b of w.s.animals!) {
    if (b.key !== a.key || b.mode === "fliegt" || b.mode === "tot" || Math.hypot(b.x - a.x, b.y - a.y) > 2.5) continue;
    b.mode = "fliegt"; b.t = 0;
    b.tx = tx + (b.x - a.x); b.ty = ty + (b.y - a.y);
    if (!suits(w, b.key, b.tx, b.ty)) { b.tx = tx; b.ty = ty; }
    b.hx = b.tx; b.hy = b.ty;
    setA(b, "auffliegen");
  }
}

function fly(w: World, a: Animal): void {
  const def = ANIMALS[a.key], L = LIFE.animals;
  a.t++;
  const up = L.takeoffSeconds * TPS;
  const d = Math.hypot(a.tx - a.x, a.ty - a.y);
  if (a.t < up) { a.z = Math.min(L.flyHeight, a.z + 2 / up); stepTo(w, a, a.tx, a.ty, def.run * 0.4, true); return; }
  setA(a, "fliegen");
  // steigen, dann im letzten Stück sinken
  const target = d > 2.5 ? L.flyHeight : L.flyHeight * (d / 2.5);
  a.z += Math.max(-0.35, Math.min(0.25, target - a.z));
  stepTo(w, a, a.tx, a.ty, def.run, true);
  if (d < 0.08 || (d < 0.3 && a.z < 0.1)) { a.z = 0; rest(w, a); }
}

/** Ein Tick aller Tiere (nach dem Raum-Raster, damit sie die Figuren dieses Ticks sehen). */
export function updateAnimals(w: World): void {
  const list = w.s.animals, life = w.meta.life;
  if (!life) return;
  if (list) {
    let removed = false;
    for (const a of list) {
      a.px = a.x; a.py = a.y; a.pz = a.z;
      a.animT += 1 / TPS;
      if (a.mode === "tot") {
        a.t++;
        if (a.anim === "sterben" && a.animT >= 0.3) setA(a, "tot");
        if (a.meat <= 0 || (a.t >= LIFE.animals.carcassSeconds * TPS && !a.reservedBy)) removed = true;
        continue;
      }
      actAnimal(w, a);
    }
    if (removed) w.s.animals = list.filter((a) => !(a.mode === "tot" && (a.meat <= 0 || (a.t >= LIFE.animals.carcassSeconds * TPS && !a.reservedBy))));
  }
  if (w.s.tick >= life.respawn) {
    life.respawn = w.s.tick + Math.round(LIFE.animals.respawnSeconds * TPS);
    for (const key of Object.keys(life.want) as AnimalKey[]) {
      const alive = (w.s.animals ?? []).filter((a) => a.key === key && a.mode !== "tot").length;
      if (alive < (life.want[key] ?? 0)) { spawnGroup(w, key, 12); break; }
    }
  }
}

function actAnimal(w: World, a: Animal): void {
  const def = ANIMALS[a.key];
  if (a.mode === "fliegt") { fly(w, a); return; }
  // Scheue Tiere sehen sich gestaffelt um
  if (def.shy > 0 && a.mode !== "flieht" && (w.s.tick + a.id) % LIFE.animals.lookTicks === 0) {
    const s = scarer(w, a, def.shy);
    if (s) {
      if (def.kind === "vogel") { takeOff(w, a, s); return; }
      flee(w, a, s);
    }
  }
  switch (a.mode) {
    case "ruht":
      if (!passable(w, a.x, a.y)) { wander(w, a); return; }
      if (--a.t <= 0) wander(w, a);
      return;
    case "zieht": {
      setA(a, "gehen");
      const ok = stepTo(w, a, a.tx, a.ty, def.speed);
      if (!ok || --a.t <= 0 || Math.hypot(a.tx - a.x, a.ty - a.y) < 0.05) rest(w, a);
      return;
    }
    case "flieht": {
      setA(a, "rennen");
      const ok = stepTo(w, a, a.tx, a.ty, def.run);
      if (!ok || --a.t <= 0 || Math.hypot(a.tx - a.x, a.ty - a.y) < 0.05) {
        // neues Streifgebiet dort, wo es zur Ruhe kommt
        a.hx = a.x; a.hy = a.y;
        rest(w, a);
      }
      return;
    }
  }
}

// ---------------------------------------------------------------- Jagd-Schnittstelle (ADR 0016)

/** Nächstes lebendes, nicht reserviertes Wild (Tiere mit `game`) im Umkreis r um (x, y), sonst null. */
export function findGame(w: World, x: number, y: number, r: number, filter?: (a: Animal) => boolean): Animal | null {
  let best: Animal | null = null, bd = r;
  for (const a of w.s.animals ?? []) {
    if (!ANIMALS[a.key].game || a.mode === "tot" || a.reservedBy) continue;
    const d = Math.hypot(a.x - x, a.y - y);
    if (d <= bd && (!filter || filter(a))) { best = a; bd = d; }
  }
  return best;
}

/** Wild bzw. erlegtes Tier für einen Jäger reservieren; false, wenn es fehlt oder ein anderer es hat. */
export function reserveGame(w: World, id: number, unit: number): boolean {
  const a = w.s.animals?.find((x) => x.id === id);
  if (!a || (a.reservedBy && a.reservedBy !== unit) || !ANIMALS[a.key].game) return false;
  a.reservedBy = unit;
  return true;
}

export function releaseGame(w: World, id: number, unit: number): void {
  const a = w.s.animals?.find((x) => x.id === id);
  if (a && a.reservedBy === unit) a.reservedBy = 0;
}

/** Schaden an Wild (Pfeil eines Jägers); bei 0 Lebenspunkten erlegt. true = jetzt tot. */
export function damageAnimal(w: World, id: number, dmg: number): boolean {
  const a = w.s.animals?.find((x) => x.id === id);
  if (!a || a.mode === "tot" || !ANIMALS[a.key].game) return false;
  a.hp -= dmg;
  if (a.hp > 0) { if (a.mode !== "flieht") flee(w, a, { x: a.x - a.fx, y: a.y - a.fy }); return false; }
  return killAnimal(w, id);
}

/** Wild erlegen: es stirbt sichtbar und bleibt mit seinem Fleisch liegen. */
export function killAnimal(w: World, id: number): boolean {
  const a = w.s.animals?.find((x) => x.id === id);
  const game = a && ANIMALS[a.key].game;
  if (!a || !game || a.mode === "tot") return false;
  a.mode = "tot"; a.t = 0; a.hp = 0; a.z = 0;
  a.meat = game.meat;
  setA(a, "sterben");
  return true;
}

/** Bis zu n Fleisch vom erlegten Tier nehmen (Jäger zerlegt und trägt); ist nichts mehr übrig, verschwindet es. */
export function takeMeat(w: World, id: number, n: number): number {
  const a = w.s.animals?.find((x) => x.id === id);
  if (!a || a.mode !== "tot") return 0;
  const k = Math.max(0, Math.min(n, a.meat));
  a.meat -= k;
  return k;
}
