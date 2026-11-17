/**
 * Militär: Verhalten eigener Soldaten je Befehl (bewegen, angreifen, halten, stationieren, untätig),
 * die Befehle selbst, Stationierung auf Mauer- und Turmposten sowie die Ausbildung in der Kaserne.
 */
import { BUILDINGS, TUNING, UNITS, type UnitKey } from "../data";
import { walkLayerAt } from "./build";
import { inRangeBuilding, inRangeUnit, isRanged, isSoldier, meleeReachable, nearestEnemy, rangeOf, strikeBuilding, strikeUnit } from "./combat";
import { entrance, postWorld, stairEnds } from "./geom";
import { goalAround, lineClear, stepToward, stop, tileGoal, travel, unitNode } from "./move";
import { available } from "./storage";
import type { CommandResult, UnitOrder } from "./types";
import { TPS, newUnitAI, setAnim, type SUnit, type World } from "./world";

// ---------------------------------------------------------------- Verhalten
export function soldierAct(w: World, u: SUnit): void {
  const o = u.order;
  switch (o.t) {
    case "move": {
      const r = travel(w, u, tileGoal(o.x, o.y, o.layer, 0));
      if (r === "arrived" || r === "unreachable") u.order = { t: "idle" };
      return;
    }
    case "attack": return attackOrder(w, u, o);
    case "hold": fightInPlace(w, u); return;
    case "station": return stationAct(w, u, o);
    default: return idleSoldier(w, u);
  }
}

function idleSoldier(w: World, u: SUnit): void {
  const ai = u.ai;
  const t = w.aliveUnit(ai.target);
  if (t) {
    const leash = TUNING.sight * 1.5;
    if (Math.hypot(t.x - u.x, t.y - u.y) <= leash && chase(w, u, t)) return;
    ai.target = 0; stop(u);
  } else ai.target = 0;
  if ((w.s.tick + u.id) % 10 === 0) {
    const e = nearestEnemy(w, u, TUNING.sight, (x) => isRanged(u.key) || meleeReachable(w, u, x));
    if (e) { ai.target = e.id; return; }
  }
  if (u.anim === "gehen" || u.anim === "angriff" || u.anim === "schiessen") setAnim(u, "stehen");
}

/** Angreifen, sonst hinterherlaufen. false = Ziel unerreichbar. */
function chase(w: World, u: SUnit, t: SUnit): boolean {
  if (inRangeUnit(u, t)) { strikeUnit(w, u, t); return true; }
  const ai = u.ai;
  const d = Math.hypot(t.x - u.x, t.y - u.y);
  if (t.layer === u.layer && d < 3 && lineClear(w, u, t.x, t.y)) {
    stepToward(w, u, t.x, t.y, isRanged(u.key) ? rangeOf(u) * 0.9 : 0.6);
    ai.goal = "";
    return true;
  }
  const tx = Math.floor(t.x), ty = Math.floor(t.y);
  if (!ai.goal || Math.hypot(tx - ai.cx, ty - ai.cy) > 1.5) { ai.cx = tx; ai.cy = ty; }
  const r = travel(w, u, tileGoal(ai.cx, ai.cy, t.layer, 1));
  return r !== "unreachable";
}

function attackOrder(w: World, u: SUnit, o: Extract<UnitOrder, { t: "attack" }>): void {
  if (o.kind === "unit") {
    const t = w.aliveUnit(o.target);
    if (!t || !chase(w, u, t)) { u.order = { t: "idle" }; stop(u); }
    return;
  }
  const b = w.buildings.get(o.target);
  if (!b || b.team === u.team) { u.order = { t: "idle" }; return; }
  if (inRangeBuilding(u, b)) { strikeBuilding(w, u, b); return; }
  if (travel(w, u, goalAround(b)) === "unreachable") u.order = { t: "idle" };
}

/** Halten bzw. auf dem Posten: nur angreifen, was in Reichweite ist. */
function fightInPlace(w: World, u: SUnit): void {
  const ai = u.ai;
  let t = w.aliveUnit(ai.target);
  if (!t || !inRangeUnit(u, t)) {
    t = undefined; ai.target = 0;
    if ((w.s.tick + u.id) % 5 === 0) {
      const e = nearestEnemy(w, u, rangeOf(u) + 0.5, (x) => inRangeUnit(u, x));
      if (e) { ai.target = e.id; t = e; }
    }
  }
  if (t) strikeUnit(w, u, t);
  else if (u.anim !== "stehen" && (u.anim !== "angriff" && u.anim !== "schiessen" || u.animT >= 0.6)) setAnim(u, "stehen");
}

function stationAct(w: World, u: SUnit, o: Extract<UnitOrder, { t: "station" }>): void {
  const b = w.buildings.get(o.building);
  const def = b && BUILDINGS[b.key];
  if (!b || !def || b.built < 1 || !def.posts?.[o.post]) { u.order = { t: "idle" }; return; }
  const [px, py, pz] = postWorld(b.key, b.x, b.y, b.o, o.post);
  const layer = def.walkway ?? 0;
  const r = travel(w, u, { ...tileGoal(Math.floor(px), Math.floor(py), layer, 0), endX: px, endY: py });
  if (r === "unreachable") { u.order = { t: "idle" }; w.msg("Der Posten ist nicht erreichbar (Treppe fehlt?).", "warnung", "posten", 10); return; }
  if (r !== "arrived") return;
  u.z = pz;
  fightInPlace(w, u);
}

// ---------------------------------------------------------------- Befehle
function ownSoldiers(w: World, ids: number[]): SUnit[] {
  const out: SUnit[] = [];
  for (const id of ids) { const u = w.aliveUnit(id); if (u && u.team === 0 && isSoldier(u.key) && !out.includes(u)) out.push(u); }
  return out;
}

const SPIRAL: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let r = 0; r <= 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) out.push([dx, dy]);
  return out.sort((a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2));
})();

export function cmdMove(w: World, ids: number[], x: number, y: number): CommandResult {
  const units = ownSoldiers(w, ids);
  if (!units.length) return { ok: false, reason: "Keine Soldaten ausgewählt" };
  if (!w.inMap(x, y)) return { ok: false, reason: "Außerhalb der Karte" };
  const nav = w.nav;
  const layer = walkLayerAt(w, x, y);
  const taken = new Set<number>();
  const moved: number[] = [];
  for (const u of units) {
    const c = nav.comp[0][unitNode(w, u)];
    let target = -1;
    for (const [dx, dy] of SPIRAL) {
      const tx = x + dx, ty = y + dy;
      if (!w.inMap(tx, ty)) continue;
      const n = nav.node(layer, tx, ty);
      if (taken.has(n) || !nav.open(n, 0) || nav.linkOnly[n]) continue;
      if (c >= 0 && nav.comp[0][n] !== c) continue;
      target = n; break;
    }
    if (target < 0 && c >= 0) target = nav.nearestInComp(0, c, x, y, layer);
    if (target < 0) continue;
    taken.add(target);
    u.order = { t: "move", x: nav.tileX(target), y: nav.tileY(target), layer: nav.layerOf(target) };
    u.ai.target = 0; stop(u);
    moved.push(u.id);
  }
  return moved.length ? { ok: true, ids: moved } : { ok: false, reason: "Dort kommt niemand hin" };
}

export function cmdAttack(w: World, ids: number[], target: number): CommandResult {
  const units = ownSoldiers(w, ids);
  if (!units.length) return { ok: false, reason: "Keine Soldaten ausgewählt" };
  const t = w.aliveUnit(target);
  const b = w.buildings.get(target);
  if (t && t.team !== 0) for (const u of units) { u.order = { t: "attack", target, kind: "unit" }; stop(u); }
  else if (b && b.team !== 0) for (const u of units) { u.order = { t: "attack", target, kind: "building" }; stop(u); }
  else return { ok: false, reason: "Kein feindliches Ziel" };
  return { ok: true, ids: units.map((u) => u.id) };
}

export function cmdHold(w: World, ids: number[]): CommandResult {
  const units = ownSoldiers(w, ids);
  if (!units.length) return { ok: false, reason: "Keine Soldaten ausgewählt" };
  for (const u of units) { u.order = { t: "hold" }; u.ai.target = 0; stop(u); setAnim(u, "stehen"); }
  return { ok: true, ids: units.map((u) => u.id) };
}

interface Post { b: number; k: number; node: number; rank: number }

/** Alle Posten, sortiert: zuerst Mauerposten nach Wegabstand zur nächsten Treppe, dann Turmposten. */
export function listPosts(w: World): Post[] {
  const nav = w.nav, W = w.s.w, walk1 = nav.walk[1];
  const distOnWall = new Map<number, number>();
  const queue: number[] = [];
  for (const b of w.s.buildings) {
    if (b.team !== 0 || b.built < 1 || !BUILDINGS[b.key].stairs) continue;
    const e = stairEnds(b.x, b.y, b.o);
    if (!w.inMap(...e.wall)) continue;
    const i = e.wall[1] * W + e.wall[0];
    if (walk1[i] && !distOnWall.has(i)) { distOnWall.set(i, 0); queue.push(i); }
  }
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h], x = i % W, y = (i / W) | 0, d = distOnWall.get(i)!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!w.inMap(nx, ny)) continue;
      const ni = ny * W + nx;
      if (walk1[ni] && !distOnWall.has(ni)) { distOnWall.set(ni, d + 1); queue.push(ni); }
    }
  }
  const posts: Post[] = [];
  for (const b of w.s.buildings) {
    const def = BUILDINGS[b.key];
    if (b.team !== 0 || b.built < 1 || !def.posts || !def.walkway) continue;
    def.posts.forEach((_, k) => {
      const [px, py] = postWorld(b.key, b.x, b.y, b.o, k);
      const tx = Math.floor(px), ty = Math.floor(py);
      if (!w.inMap(tx, ty)) return;
      const node = nav.node(def.walkway!, tx, ty);
      const rank = def.walkway === 1 ? distOnWall.get(ty * W + tx) ?? 500 : 1000;
      posts.push({ b: b.id, k, node, rank });
    });
  }
  return posts.sort((a, b) => a.rank - b.rank || a.b - b.b || a.k - b.k);
}

export function cmdStation(w: World, ids: number[]): CommandResult {
  const units = ownSoldiers(w, ids).filter((u) => UNITS[u.key].canStation);
  if (!units.length) return { ok: false, reason: "Keine Soldaten ausgewählt" };
  for (const u of units) if (u.order.t === "station") u.order = { t: "idle" };
  const occupied = new Set<string>();
  for (const u of w.s.units) if (!u.dead && u.order.t === "station") occupied.add(`${u.order.building}:${u.order.post}`);
  const posts = listPosts(w);
  if (!posts.length) return { ok: false, reason: "Keine fertige Mauer mit Posten" };
  const placed: number[] = [];
  // Schützen zuerst auf die Posten, Nahkämpfer danach
  const order = [...units].sort((a, b) => Number(isRanged(b.key)) - Number(isRanged(a.key)));
  for (const u of order) {
    const c = w.nav.comp[0][unitNode(w, u)];
    const p = posts.find((q) => !occupied.has(`${q.b}:${q.k}`) && (c < 0 || w.nav.comp[0][q.node] === c));
    if (!p) continue;
    occupied.add(`${p.b}:${p.k}`);
    u.order = { t: "station", building: p.b, post: p.k };
    u.ai.target = 0; stop(u);
    placed.push(u.id);
  }
  if (!placed.length) return { ok: false, reason: "Kein freier, erreichbarer Posten (Treppe gebaut?)" };
  return placed.length < units.length
    ? { ok: true, ids: placed, reason: "Nicht genug freie Posten für alle" }
    : { ok: true, ids: placed };
}

// ---------------------------------------------------------------- Ausbildung
export function cmdRecruit(w: World, id: number, unit: UnitKey): CommandResult {
  const b = w.buildings.get(id);
  if (!b || b.team !== 0) return { ok: false, reason: "Keine eigene Kaserne" };
  const def = BUILDINGS[b.key];
  if (!def.trains?.includes(unit)) return { ok: false, reason: `${def.name} bildet das nicht aus` };
  if (b.built < 1) return { ok: false, reason: `${def.name} ist noch nicht fertig` };
  const train = UNITS[unit].train!;
  if (w.s.gold < train.gold) return { ok: false, reason: "Nicht genug Gold" };
  if (available(w, train.equipment) < 1) return { ok: false, reason: `Keine ${goodLabel(train.equipment)} im Lager` };
  const queued = w.s.buildings.reduce((n, x) => n + x.queue.length, 0);
  const peasants = w.s.units.filter((u) => !u.dead && u.team === 0 && u.key === "tageloehner" && u.ai.job?.k !== "recruit").length;
  if (peasants <= queued) return { ok: false, reason: "Kein freier Tagelöhner" };
  w.s.gold -= train.gold;
  b.queue.push(unit);
  return { ok: true, ids: [b.id] };
}

const goodLabel = (g: string): string => ({ speer: "Speere", schwert: "Schwerter", bogen: "Bögen" } as Record<string, string>)[g] ?? g;

/** Ausbildung voranbringen; fertige Soldaten treten am Eingang heraus. */
export function updateTraining(w: World): void {
  for (const b of w.s.buildings) {
    const tr = b.training;
    if (!tr) continue;
    tr.t = Math.min(tr.dur, tr.t + 1 / TPS);
    if (tr.t < tr.dur - 1e-9) continue;
    const u = b.ai.inside;
    b.training = null; b.ai.inside = null;
    if (!u) continue;
    const def = UNITS[tr.unit];
    const [ex, ey] = entrance(b.key, b.x, b.y, b.o);
    u.key = tr.unit; u.maxHp = def.hp; u.hp = def.hp;
    u.x = u.px = ex + 0.5; u.y = u.py = ey + 0.5; u.z = u.pz = 0; u.layer = 0;
    u.carry = null; u.home = 0; u.dead = false; u.order = { t: "idle" };
    u.ai = newUnitAI();
    setAnim(u, "stehen", true);
    w.insertUnit(u);
    w.msg(`${def.name} ist ausgebildet.`);
  }
}
