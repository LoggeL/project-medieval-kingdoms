/**
 * Militär: Verhalten eigener Soldaten je Befehl (bewegen, angreifen, halten, stationieren, untätig),
 * die Befehle selbst, Stationierung auf Mauer- und Turmposten sowie die Ausbildung in der Kaserne.
 *
 * Auf dem Posten schießen Schützen auf das gefährlichste Ziel in Reichweite (combat.pickTarget). Nahkämpfer bewachen
 * ihren Abschnitt: Kommt ein Gegner bis auf TUNING.postLeash Felder an ein Tor oder eine Treppe in der Nähe ihres
 * Postens (TUNING.postGuardRadius) oder steigt er auf den Wehrgang, gehen sie hin (über Treppe und Tor), kämpfen und
 * kehren danach auf ihren Posten zurück.
 */
import { BUILDINGS, GOODS, LIFE, TECHS, TUNING, UNITS, levelDef, trainCost, type Good, type UnitKey } from "../data";
import { walkLayerAt } from "./build";
import { inRangeBuilding, inRangeUnit, isRanged, isSoldier, meleeReachable, nearestEnemy, pickTarget, rangeOf, strikeBuilding, strikeUnit } from "./combat";
import { entrance, footprint, postWorld, stairEnds } from "./geom";
import { goalAround, lineClear, stepToward, stop, tileGoal, travel, unitNode } from "./move";
import { available } from "./storage";
import { applyBoost, levelOf, lockedBy } from "./research";
import type { CommandResult, UnitOrder } from "./types";
import { ladderDuty } from "./belagerung";
import { TPS, distToRect, newUnitAI, setAnim, type SBuilding, type SUnit, type World } from "./world";

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
    const e = isRanged(u.key)
      ? pickTarget(w, u, TUNING.sight, () => true)
      : nearestEnemy(w, u, TUNING.sight, (x) => meleeReachable(w, u, x));
    if (e) { ai.target = e.id; return; }
  }
  if (u.anim === "gehen" || u.anim === "angriff" || u.anim === "schiessen") setAnim(u, "stehen");
}

/** Angreifen, sonst hinterherlaufen. false = Ziel unerreichbar. */
function chase(w: World, u: SUnit, t: SUnit): boolean {
  if (inRangeUnit(u, t)) { strikeUnit(w, u, t); return true; }
  const ai = u.ai;
  const d = Math.hypot(t.x - u.x, t.y - u.y);
  if (t.layer === u.layer && d < 3 && lineClear(w, u, t.x, t.y) && stepToward(w, u, t.x, t.y, isRanged(u.key) ? rangeOf(u) * 0.9 : 0.6)) {
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

/** Halten bzw. auf dem Posten: nur angreifen, was in Reichweite ist (Schützen: das gefährlichste Ziel). */
function fightInPlace(w: World, u: SUnit): void {
  const ai = u.ai;
  let t = w.aliveUnit(ai.target);
  if (!t || !inRangeUnit(u, t)) { t = undefined; ai.target = 0; ai.lock = 0; }
  if (isRanged(u.key) ? (!t || (w.s.tick + u.id) % 5 === 0) : !t && (w.s.tick + u.id) % 5 === 0) {
    const e = isRanged(u.key)
      ? pickTarget(w, u, rangeOf(u) + 0.5, (x) => inRangeUnit(u, x))
      : nearestEnemy(w, u, rangeOf(u) + 0.5, (x) => inRangeUnit(u, x));
    ai.target = e ? e.id : 0;
    t = e ?? undefined;
  }
  if (t) strikeUnit(w, u, t);
  else if (u.anim !== "stehen" && (u.anim !== "angriff" && u.anim !== "schiessen" || u.animT >= 0.6)) setAnim(u, "stehen");
}

/** Tore und Treppen, die ein Nahkämpfer von seinem Posten aus bewacht. */
function guarded(w: World, px: number, py: number): SBuilding[] {
  const out: SBuilding[] = [];
  for (const b of w.s.buildings) {
    const def = BUILDINGS[b.key];
    if (b.team !== 0 || b.built < 1 || !(def.gate || def.stairs)) continue;
    const [fw, fh] = footprint(b.key, b.o);
    if (distToRect(px, py, b.x, b.y, b.x + fw, b.y + fh) <= TUNING.postGuardRadius) out.push(b);
  }
  return out;
}

/** Liegt der Gegner im bewachten Abschnitt: höchstens postLeash Felder von einem bewachten Tor bzw. einer Treppe, oder auf dem Wehrgang nahe dem Posten? */
function inSection(t: SUnit, anchors: SBuilding[], px: number, py: number): boolean {
  if (t.layer > 0 && Math.hypot(t.x - px, t.y - py) <= TUNING.postGuardRadius) return true;
  for (const b of anchors) {
    const [fw, fh] = footprint(b.key, b.o);
    if (distToRect(t.x, t.y, b.x, b.y, b.x + fw, b.y + fh) <= TUNING.postLeash) return true;
  }
  return false;
}

/**
 * Nahkämpfer auf dem Posten: Gegner im Abschnitt angreifen (hinunter über die Treppe, durch das Tor, auf dem
 * Wehrgang entlang). true = er kämpft oder ist unterwegs zum Gegner; false = zurück auf den Posten.
 */
function guardSection(w: World, u: SUnit, px: number, py: number): boolean {
  const ai = u.ai;
  const anchors = guarded(w, px, py);
  const t = w.aliveUnit(ai.target);
  // Erreichbarkeit nur bei der Wahl prüfen: auf der Treppe zwischen zwei Ebenen liefert sie kurz kein Ergebnis
  if (t && t.team !== u.team && !t.ai.retreat && inSection(t, anchors, px, py)) {
    if (chase(w, u, t)) { ai.sortie = true; return true; }
  }
  ai.target = 0;
  if ((w.s.tick + u.id) % 10 === 0) {
    let best: SUnit | null = null, bd = Infinity;
    w.grid.query(px, py, TUNING.postGuardRadius + TUNING.postLeash + 1, (o) => {
      const e = o as SUnit;
      if (e.team === u.team || e.dead || e.ai.retreat || !inSection(e, anchors, px, py) || !meleeReachable(w, u, e)) return;
      const d = Math.hypot(e.x - u.x, e.y - u.y);
      if (d < bd || (d === bd && best && e.id < best.id)) { best = e; bd = d; }
    });
    if (best) { ai.target = (best as SUnit).id; ai.sortie = true; return chase(w, u, best) || (ai.target = 0, false); }
  }
  return false;
}

function stationAct(w: World, u: SUnit, o: Extract<UnitOrder, { t: "station" }>): void {
  const b = w.buildings.get(o.building);
  const def = b && levelDef(b.key, levelOf(b));
  if (!b || !def || b.built < 1 || !def.posts?.[o.post]) { u.order = { t: "idle" }; return; }
  const [px, py, pz] = postWorld(b.key, b.x, b.y, b.o, o.post, levelOf(b));
  const layer = def.walkway ?? 0;
  // Nahkämpfer verteidigen Tor, Treppe und Wehrgang in der Nähe; danach zurück auf den Posten
  if (!isRanged(u.key) && guardSection(w, u, px, py)) return;
  // … und stoßen Sturmleitern in ihrem Abschnitt um (belagerung.ts)
  if (!isRanged(u.key) && ladderDuty(w, u, px, py)) return;
  u.ai.sortie = false;
  const r = travel(w, u, { ...tileGoal(Math.floor(px), Math.floor(py), layer, 0), endX: px, endY: py });
  if (r === "unreachable") { u.order = { t: "idle" }; w.msg("Der Posten ist nicht erreichbar (Treppe fehlt?).", "warnung", "posten", 10, "kein_posten"); return; }
  if (r !== "arrived") return;
  u.z = pz;
  fightInPlace(w, u);
  guardIdle(w, u);
}

/**
 * Wache ohne Gegner (ADR 0016): dreht sich alle LIFE.guard.lookSeconds ein Stück (schaut sich um) und tritt dabei kurz
 * von einem Fuß auf den anderen (Gehbilder auf der Stelle; die Wache verlässt ihren Posten nicht). Rein aus Tick und ID.
 */
function guardIdle(w: World, u: SUnit): void {
  const ai = u.ai;
  if (ai.target || (u.anim !== "stehen" && u.anim !== "gehen")) { delete ai.step; return; }
  const G = LIFE.guard, per = Math.round(G.lookSeconds * TPS), len = Math.round(G.stepSeconds * TPS);
  const k = w.s.tick + u.id * 29;
  if (k % per === 0) {
    const turn = [1, -1, 2, -1, -2, 1][Math.floor(k / per) % 6] * (Math.PI / 4);
    const c = Math.cos(turn), s = Math.sin(turn);
    const fx = u.fx * c - u.fy * s, fy = u.fx * s + u.fy * c;
    u.fx = fx; u.fy = fy;
    ai.step = w.s.tick + len;
  }
  if (ai.step && w.s.tick < ai.step) { u.anim = "gehen"; u.animT = (w.s.tick - (ai.step - len)) / TPS; return; }
  if (ai.step) delete ai.step;
  if (u.anim !== "stehen") setAnim(u, "stehen");
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

export interface Post {
  b: number; k: number;
  /** Knoten des Postens (Ebene 1 Wehrgang, 2 Turm). */
  node: number;
  x: number; y: number;
  tower: boolean;
  /** Abstand zur Feindseite (0 = der Bedrohung am nächsten). */
  front: number;
  /** Wegabstand auf dem Wehrgang zum nächsten Zugang (Treppe, Tor, Turm), 500 ohne Zugang. */
  access: number;
}

/** Woher Gefahr droht: Mittel der lebenden Angreifer, sonst der Anmarschpunkt der Überfälle. */
export function threatPoint(w: World): [number, number] {
  let sx = 0, sy = 0, n = 0;
  for (const u of w.s.units) if (u.team === 1 && !u.dead) { sx += u.x; sy += u.y; n++; }
  if (n) return [sx / n, sy / n];
  return [w.meta.raidSpawn[0] + 0.5, w.meta.raidSpawn[1] + 0.5];
}

/** Alle eigenen Posten mit Feindseite und Zugang (unsortiert). */
export function listPosts(w: World): Post[] {
  const nav = w.nav, W = w.s.w, walk1 = nav.walk[1];
  const access = new Map<number, number>();
  const queue: number[] = [];
  const seed = (x: number, y: number) => {
    if (!w.inMap(x, y)) return;
    const i = y * W + x;
    if (walk1[i] && !access.has(i)) { access.set(i, 0); queue.push(i); }
  };
  for (const b of w.s.buildings) {
    if (b.team !== 0 || b.built < 1) continue;
    const def = levelDef(b.key, levelOf(b));
    if (def.stairs) { const e = stairEnds(b.x, b.y, b.o); seed(e.wall[0], e.wall[1]); }
    else if (def.gate) seed(b.x, b.y);
    else if (def.walkway === 2) {
      // Turmtür: Wehrgang-Tiles am Turm sind über die Plattform vom Boden aus erreichbar
      const [fw, fh] = footprint(b.key, b.o);
      for (let x = b.x - 1; x <= b.x + fw; x++) for (let y = b.y - 1; y <= b.y + fh; y++) {
        const inX = x >= b.x && x < b.x + fw, inY = y >= b.y && y < b.y + fh;
        if (inX !== inY) seed(x, y);
      }
    }
  }
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h], x = i % W, y = (i / W) | 0, d = access.get(i)!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!w.inMap(nx, ny)) continue;
      const ni = ny * W + nx;
      if (walk1[ni] && !access.has(ni)) { access.set(ni, d + 1); queue.push(ni); }
    }
  }
  const [tx0, ty0] = threatPoint(w);
  const posts: Post[] = [];
  for (const b of w.s.buildings) {
    const def = levelDef(b.key, levelOf(b));
    if (b.team !== 0 || b.built < 1 || !def.posts || !def.walkway) continue;
    def.posts.forEach((_, k) => {
      const [px, py] = postWorld(b.key, b.x, b.y, b.o, k, levelOf(b));
      const tx = Math.floor(px), ty = Math.floor(py);
      if (!w.inMap(tx, ty)) return;
      const tower = def.walkway === 2;
      posts.push({
        b: b.id, k, node: nav.node(def.walkway!, tx, ty), x: px, y: py, tower,
        front: Math.hypot(px - tx0, py - ty0), access: tower ? 0 : access.get(ty * W + tx) ?? 500,
      });
    });
  }
  let min = Infinity;
  for (const p of posts) min = Math.min(min, p.front);
  for (const p of posts) p.front -= min;
  return posts.sort((a, b) => a.b - b.b || a.k - b.k);
}

/** Abstand, ab dem zwei besetzte Posten nicht mehr als „zu dicht“ gelten (Tiles). */
const SPREAD = 3;

/**
 * Bewertung eines freien Postens für eine Einheit (kleiner = besser):
 * Schützen: Feindseite, Türme zuerst (Bonus), gleichmäßig verteilt (Abzug für Nähe zu besetzten Posten anderer Gebäude).
 * Nahkämpfer: nur Wehrgang (keine Turm-Schützenposten), nahe an Treppen und Toren, dann Feindseite, ebenfalls verteilt.
 */
function postScore(p: Post, ranged: boolean, taken: Post[]): number {
  if (!ranged && p.tower) return Infinity;
  let crowd = 0;
  for (const q of taken) {
    if (q.b === p.b) continue; // Posten desselben Turms bilden eine Gruppe
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < SPREAD) crowd = Math.max(crowd, SPREAD - d);
  }
  if (ranged) return p.front + 4 * crowd - (p.tower ? 4 : 0);
  return Math.min(p.access, 50) + 0.4 * p.front + crowd;
}

export function cmdStation(w: World, ids: number[]): CommandResult {
  const units = ownSoldiers(w, ids).filter((u) => UNITS[u.key].canStation);
  if (!units.length) return { ok: false, reason: "Keine Soldaten ausgewählt" };
  for (const u of units) if (u.order.t === "station") u.order = { t: "idle" };
  const posts = listPosts(w);
  if (!posts.length) return { ok: false, reason: "Keine fertige Mauer mit Posten", voice: "kein_posten" };
  const byKey = new Map(posts.map((p) => [`${p.b}:${p.k}`, p]));
  const taken: Post[] = [];
  const occupied = new Set<string>();
  for (const u of w.s.units) if (!u.dead && u.order.t === "station") {
    const key = `${u.order.building}:${u.order.post}`;
    occupied.add(key);
    const p = byKey.get(key);
    if (p) taken.push(p);
  }
  const placed: number[] = [];
  // Schützen zuerst (Türme, Feindseite), Nahkämpfer danach (Wehrgang an Treppen und Toren)
  const order = [...units].sort((a, b) => Number(isRanged(b.key)) - Number(isRanged(a.key)) || a.id - b.id);
  for (const u of order) {
    const c = w.nav.comp[0][unitNode(w, u)];
    const ranged = isRanged(u.key);
    let best: Post | null = null, bs = Infinity;
    for (const p of posts) {
      if (occupied.has(`${p.b}:${p.k}`) || (c >= 0 && w.nav.comp[0][p.node] !== c)) continue;
      const sc = postScore(p, ranged, taken);
      if (sc < bs) { bs = sc; best = p; }
    }
    if (!best) continue;
    occupied.add(`${best.b}:${best.k}`);
    taken.push(best);
    u.order = { t: "station", building: best.b, post: best.k };
    u.ai.target = 0; stop(u);
    placed.push(u.id);
  }
  if (!placed.length) return { ok: false, reason: "Kein freier, erreichbarer Posten (Treppe gebaut?)", voice: "kein_posten" };
  return placed.length < units.length
    ? { ok: true, ids: placed, reason: "Nicht genug freie Posten für alle", voice: "kein_posten" }
    : { ok: true, ids: placed, voice: "stationiert" };
}

// ---------------------------------------------------------------- Ausbildung
export function cmdRecruit(w: World, id: number, unit: UnitKey): CommandResult {
  const b = w.buildings.get(id);
  if (!b || b.team !== 0) return { ok: false, reason: "Keine eigene Kaserne" };
  const def = BUILDINGS[b.key];
  if (!def.trains?.includes(unit)) return { ok: false, reason: `${def.name} bildet das nicht aus` };
  if (b.built < 1) return { ok: false, reason: `${def.name} ist noch nicht fertig` };
  const lock = lockedBy(w.s, UNITS[unit]);
  if (lock) return { ok: false, reason: `Erst erforschen: ${TECHS[lock].name}` };
  const train = UNITS[unit].train!;
  if (w.s.gold < train.gold) return { ok: false, reason: "Nicht genug Gold", voice: "zu_teuer" };
  for (const [g, n] of Object.entries(trainCost(UNITS[unit])) as [Good | "gold", number][]) {
    if (g !== "gold" && available(w, g) < n) return { ok: false, reason: `Keine ${goodLabel(g)} im Lager`, voice: "keine_waffe" };
  }
  const queued = w.s.buildings.reduce((n, x) => n + x.queue.length, 0);
  const peasants = w.s.units.filter((u) => !u.dead && u.team === 0 && u.key === "tageloehner" && u.ai.job?.k !== "recruit").length;
  if (peasants <= queued) return { ok: false, reason: "Kein freier Tagelöhner" };
  w.s.gold -= train.gold;
  b.queue.push(unit);
  return { ok: true, ids: [b.id] };
}

const goodLabel = (g: Good): string => GOODS[g].name;

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
    let [ex, ey] = entrance(b.key, b.x, b.y, b.o);
    if (!w.inMap(ex, ey) || !w.nav.open(w.nav.node(0, ex, ey), 0)) {
      // Eingang zugebaut: am nächsten freien Tile heraustreten
      const n = w.nav.nearestOpen(0, Math.min(w.s.w - 1, Math.max(0, ex)), Math.min(w.s.h - 1, Math.max(0, ey)), 0, 8);
      if (n >= 0) { ex = w.nav.tileX(n); ey = w.nav.tileY(n); }
    }
    u.key = tr.unit; u.maxHp = def.hp; u.hp = def.hp;
    u.x = u.px = ex + 0.5; u.y = u.py = ey + 0.5; u.z = u.pz = 0; u.layer = 0;
    u.carry = null; u.home = 0; u.dead = false; u.order = { t: "idle" };
    u.ai = newUnitAI();
    applyBoost(w, u);
    setAnim(u, "stehen", true);
    w.insertUnit(u);
    w.msg(`${def.name} ist ausgebildet.`, "info", undefined, 20, "ausgebildet");
  }
}
