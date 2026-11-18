/**
 * Belagerung und Befestigung (ADR 0017): Sturmleitern, Rammbock samt Mannschaft, Trümmer (Breschen), Graben,
 * Schadensstufen, Reparatur durch Tagelöhner und Heilung verwundeter Leute. Werte in src/data/belagerung.ts.
 *
 * Sturmleiter: Ein Sturmknecht mit Leiter (Unit.gear) sucht ein Stück Wehrgang, dessen Fuß er ohne Einreißen erreicht
 * (unbesetzte Stellen zuerst), richtet die Leiter dort auf (SIEGE.ladderPlaceSeconds) und kämpft danach wie jeder
 * Angreifer. Die stehende Leiter ist im Laufraster ein Übergang Boden ↔ Wehrgang nur für Angreifer (nav.foeLinks); wer
 * hinaufsteigt, klettert sichtbar (Höhe steigt, langsam). Verteidiger auf dem Wehrgang am Leiterkopf stoßen sie um,
 * solange oben kein Angreifer steht; wer dann auf der Leiter ist, stürzt und nimmt Schaden.
 *
 * Rammbock: ein Gerät (UnitDef.vehicle), das nur am Boden fährt (Bodenmodus der Pfadsuche) und nur, solange seine
 * Mannschaft bei ihm ist. Er hält auf das nächste Tor zu, sonst auf die Befestigung, die ihm den Weg versperrt, und
 * stößt es ein (Schadensart Wucht). Fällt die ganze Mannschaft, ist er aufgegeben.
 *
 * Bresche: Zerstörte Befestigungen hinterlassen Trümmer (RUINS), die begehbar, aber langsam sind; ein zugeschütteter
 * Graben ebenso. Baut der Spieler dort neu, verschwinden sie.
 */
import { BUILDINGS, HEAL, REPAIR, RUINS, SIEGE, DAMAGE_STAGES, UNITS, TUNING, levelDef, type Good } from "../data";
import { inRangeBuilding, inRangeUnit, isRanged, isSoldier, kill, meleeReachable, nearestEnemy, strikeBuilding, strikeUnit, vanish } from "./combat";
import { center, footprint, footprintTiles, modelToWorld } from "./geom";
import { carryBack, releaseJob, storeVisit } from "./jobs";
import { removeBuilding } from "./build";
import { blockedNode, goalAround, goalSlot, stepToward, stop, tileGoal, travel, unitNode, type TravelGoal } from "./move";
import { OPEN } from "./nav";
import { goodsOf, levelOf, workFactor } from "./research";
import { available, reserveTake, tidy } from "./storage";
import type { Building, CommandResult, Ladder, Rubble } from "./types";
import { TPS, dist, distToRect, face, setAnim, type Job, type SBuilding, type SUnit, type World } from "./world";

type RepairJob = Extract<Job, { k: "repair" }>;

// ---------------------------------------------------------------- Schadensstufen
/** Lebenspunkte eines unversehrten Gebäudes (auf seiner Ausbaustufe). */
export function maxHpOf(b: Building): number {
  return levelDef(b.key, levelOf(b)).hp;
}

/** Sichtbare Schadensstufe 0 (unversehrt) bis 3 (dem Einsturz nahe); Baustellen zeigen keine. */
export function damageStage(b: Building): number {
  if (b.built < 1) return 0;
  const f = b.hp / maxHpOf(b);
  let k = 0;
  for (const t of DAMAGE_STAGES) if (f < t) k++;
  return k;
}

// ---------------------------------------------------------------- Trümmer
/** Trümmer einer zerstörten Befestigung (bzw. eines zugeschütteten Grabens) auf ihren Grundriss legen. */
export function addRuins(w: World, b: SBuilding): void {
  const ruin = RUINS[b.key];
  if (!ruin) return;
  const list = (w.s.rubble ??= []);
  for (const [x, y] of footprintTiles(b.key, b.x, b.y, b.o)) {
    if (!w.inMap(x, y)) continue;
    const i = list.findIndex((r) => r.x === x && r.y === y);
    const r: Rubble = { x, y, sprite: ruin.sprite, v: (Math.imul(x * 73856093 ^ y * 19349663, 2654435761) >>> 16) % ruin.variants, o: b.o };
    if (i >= 0) list[i] = r; else list.push(r);
  }
}

/** Trümmer auf diesen Tiles räumen (neuer Bau). */
export function clearRubble(w: World, tiles: [number, number][]): void {
  if (!w.s.rubble?.length) return;
  const set = new Set(tiles.map(([x, y]) => y * w.s.w + x));
  w.s.rubble = w.s.rubble.filter((r) => !set.has(r.y * w.s.w + r.x));
}

// ---------------------------------------------------------------- Sturmleitern
const LADDER_O: Record<string, number> = { "0,-1": 0, "-1,0": 1, "0,1": 2, "1,0": 3 };

/** Ausrichtung einer Leiter: Modell +y zeigt vom Fuß (fx, fy) zur Mauer (wx, wy). */
export function ladderOrientation(fx: number, fy: number, wx: number, wy: number): number {
  return LADDER_O[`${wx - fx},${wy - fy}`] ?? 0;
}

const ladders = (w: World): Ladder[] => (w.s.ladders ??= []);

/** Wehrgang-Tile, an das eine Leiter angelegt werden kann (fertiger, eigener Bau mit Laufebene 1). */
function wallTile(w: World, x: number, y: number): SBuilding | undefined {
  const b = w.buildingAt(x, y);
  return b && b.team === 0 && b.built >= 1 && levelDef(b.key, levelOf(b)).walkway === 1 ? b : undefined;
}

/**
 * Gibt es eine fertige eigene Mauer mit Wehrgang, an die eine Leiter passt? Ohne sie bringt eine Welle keine
 * Sturmleitern mit, sondern Krieger an ihrer Stelle (raid.spawnWave).
 */
export function hasLadderWall(w: World): boolean {
  for (const b of w.s.buildings) if (wallTile(w, b.x, b.y) === b) return true;
  return false;
}

function ladderBusy(w: World, x: number, y: number, self: number): boolean {
  for (const l of ladders(w)) if (l.state !== "liegt" && ((l.x === x && l.y === y) || (l.wx === x && l.wy === y))) return true;
  for (const u of w.s.units) {
    const p = u.ai.ladder;
    if (u.id !== self && !u.dead && p && ((p.fx === x && p.fy === y) || (p.wx === x && p.wy === y))) return true;
  }
  return false;
}

/** Steht am Fuß der Leiter ein Gebäude? Wege, Pflaster und Brücken (BuildingDef.road, fertig oder im Bau) nicht. */
function blocksLadder(w: World, x: number, y: number): boolean {
  const b = w.buildingAt(x, y);
  return !!b && !BUILDINGS[b.key].road;
}

/** Ist der Leiterplan noch ausführbar (Mauer steht, Fuß frei und für Angreifer begehbar)? */
function planValid(w: World, u: SUnit, p: NonNullable<SUnit["ai"]["ladder"]>): boolean {
  if (!wallTile(w, p.wx, p.wy) || !w.inMap(p.fx, p.fy) || blocksLadder(w, p.fx, p.fy)) return false;
  if (w.nav.walk[0][p.fy * w.s.w + p.fx] !== OPEN) return false;
  return !ladderBusy(w, p.fx, p.fy, u.id) && !ladderBusy(w, p.wx, p.wy, u.id);
}

/**
 * Stelle für die Leiter wählen: ein Boden-Tile neben einem Wehrgang-Tile, das der Sturmknecht ohne Einreißen erreicht;
 * kurze Wege zuerst, besetzte Mauerstücke (Verteidiger in der Nähe) nur, wenn es nichts anderes gibt.
 */
function chooseLadderSpot(w: World, u: SUnit): SUnit["ai"]["ladder"] {
  const nav = w.nav, W = w.s.w;
  const my = nav.comp[1][unitNode(w, u)];
  let best: SUnit["ai"]["ladder"], bs = Infinity;
  for (const b of w.s.buildings) {
    if (b.team !== 0 || b.built < 1 || levelDef(b.key, levelOf(b)).walkway !== 1) continue;
    for (const [wx, wy] of footprintTiles(b.key, b.x, b.y, b.o)) {
      let manned = 0;
      for (const d of w.s.units) if (d.team === 0 && !d.dead && d.layer > 0 && isSoldier(d.key) && dist(d.x, d.y, wx + 0.5, wy + 0.5) <= 2.5) manned++;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const fx = wx + dx, fy = wy + dy;
        if (!w.inMap(fx, fy) || blocksLadder(w, fx, fy) || nav.walk[0][fy * W + fx] !== OPEN) continue;
        if (my >= 0 && nav.comp[1][nav.node(0, fx, fy)] !== my) continue;
        if (ladderBusy(w, fx, fy, u.id) || ladderBusy(w, wx, wy, u.id)) continue;
        const sc = dist(u.x, u.y, fx + 0.5, fy + 0.5) + 10 * manned;
        if (sc < bs) { bs = sc; best = { fx, fy, wx, wy, t: 0 }; }
      }
    }
  }
  return best;
}

/**
 * Sturmknecht mit Leiter. true = gehandelt; false = er trägt keine (mehr) und handelt wie jeder Angreifer. Wird er im
 * Nahkampf gestellt oder gibt es keine Mauer, wirft er die Leiter weg.
 */
export function ladderCarrierAct(w: World, u: SUnit): boolean {
  if (u.gear !== "leiter" || u.ai.retreat) return false;
  const ai = u.ai;
  const foe = nearestEnemy(w, u, 1.4, (t) => meleeReachable(w, u, t));
  if (foe) { dropGear(u); return false; }
  if (ai.ladder && !planValid(w, u, ai.ladder)) ai.ladder = undefined;
  if (!ai.ladder) {
    if (--ai.think > 0) { setAnim(u, "stehen"); return true; }
    ai.think = TPS;
    ai.ladder = chooseLadderSpot(w, u);
    if (!ai.ladder) { dropGear(u); return false; }
  }
  const p = ai.ladder;
  if (p.t === 0) {
    const r = travel(w, u, tileGoal(p.fx, p.fy, 0, 0));
    if (r === "unreachable") { ai.ladder = undefined; return true; }
    if (r !== "arrived") return true;
  }
  face(u, p.wx - p.fx, p.wy - p.fy);
  setAnim(u, "stehen");
  if (++p.t < SIEGE.ladderPlaceSeconds * TPS) return true;
  ladders(w).push({ id: w.newId(), x: p.fx, y: p.fy, wx: p.wx, wy: p.wy, o: ladderOrientation(p.fx, p.fy, p.wx, p.wy), state: "steht", t: 0, push: 0 });
  ai.ladder = undefined;
  dropGear(u);
  ai.think = 0;
  w.nav.refresh(); // nur die Kacheln der Leiter (ADR 0015)
  w.msg("Sturmleitern an der Mauer! Verteidiger oben stoßen sie um.", "kampf", "leiter", 20);
  return true;
}

function dropGear(u: SUnit): void {
  delete u.gear;
  u.ai.ladder = undefined;
}

/** Steht die Figur gerade an einer Leiter (Höhe über dem Boden, nicht auf einer Treppe)? */
export function onLadder(w: World, u: SUnit): boolean {
  return u.layer === 0 && u.z > 0.05 && w.nav.stairZ(u.x, u.y) < 0;
}

/** Verteidiger, die eine stehende Leiter gerade umstoßen. */
function pushers(w: World, l: Ladder): SUnit[] {
  const out: SUnit[] = [];
  const hx = l.wx + 0.5, hy = l.wy + 0.5;
  w.grid.query(hx, hy, SIEGE.ladderPushReach, (o) => {
    const u = o as SUnit;
    if (u.team === 0 && !u.dead && u.layer === 1 && isSoldier(u.key) && dist(u.x, u.y, hx, hy) <= SIEGE.ladderPushReach) out.push(u);
  });
  return out.sort((a, b) => a.id - b.id);
}

/** Leitern: umstoßen (Verteidiger am Leiterkopf), kippen, liegen, verschwinden. Einmal je Tick nach den Einheiten. */
export function updateLadders(w: World): void {
  const list = w.s.ladders;
  if (!list?.length) return;
  let changed = false;
  // Lebt kein Angreifer mehr (Überfall abgewehrt), werfen die Verteidiger die übrigen Leitern um
  const foes = w.s.units.some((u) => u.team === 1 && !u.dead);
  for (const l of list) {
    if (l.state === "steht") {
      const W = w.s.w;
      if (!foes || !wallTile(w, l.wx, l.wy) || w.nav.walk[0][l.y * W + l.x] !== OPEN) { topple(w, l); changed = true; continue; }
      const ps = pushers(w, l);
      if (!ps.length) { l.push = Math.max(0, l.push - 0.5 / TPS); continue; }
      let guarded = false;
      w.grid.query(l.wx + 0.5, l.wy + 0.5, SIEGE.ladderHeadGuard, (o) => {
        if (o.team === 1 && !o.dead && o.layer === 1 && dist(o.x, o.y, l.wx + 0.5, l.wy + 0.5) <= SIEGE.ladderHeadGuard) guarded = true;
      });
      if (guarded) continue;
      l.push += Math.min(2, ps.length) / (SIEGE.ladderPushSeconds * TPS);
      for (const u of ps) {
        u.activity = "stoesst_um";
        if (u.anim === "stehen" || u.anim === "gehen") { face(u, l.x - l.wx, l.y - l.wy); setAnim(u, "angriff", true); }
      }
      if (l.push >= 1) { topple(w, l); changed = true; w.msg("Eine Sturmleiter ist umgestoßen!", "kampf", "leiter-um", 8); }
    } else {
      l.t += 1 / TPS;
      if (l.state === "faellt" && l.t >= SIEGE.ladderFallSeconds) { l.state = "liegt"; l.t = 0; }
    }
  }
  const keep = list.filter((l) => !(l.state === "liegt" && l.t >= SIEGE.ladderLieSeconds));
  if (keep.length !== list.length) w.s.ladders = keep;
  if (changed) w.nav.refresh();
}

/** Leiter kippt: wer auf ihr steht, stürzt am Fuß herunter; alle Angreifer planen ihren Weg neu. */
function topple(w: World, l: Ladder): void {
  l.state = "faellt"; l.t = 0; l.push = 0;
  const mx = (l.x + l.wx) / 2 + 0.5, my = (l.y + l.wy) / 2 + 0.5;
  for (const u of w.s.units) {
    if (u.dead || u.team !== 1) continue;
    if (onLadder(w, u) && dist(u.x, u.y, mx, my) <= 1.2) {
      u.x = u.px = l.x + 0.5; u.y = u.py = l.y + 0.5; u.z = u.pz = 0;
      u.hp -= SIEGE.ladderFallDamage;
      u.ai.hurtT = w.s.tick;
      if (u.hp <= 0) kill(w, u);
    }
    stop(u);
  }
}

/** Ein Wehrgang-Bau verschwindet: Leitern daran fallen. */
export function laddersLoseWall(w: World, b: SBuilding): void {
  for (const l of w.s.ladders ?? []) {
    if (l.state !== "steht") continue;
    const id = w.s.tiles[l.wy * w.s.w + l.wx]?.building;
    if (!id || id === b.id) topple(w, l);
  }
}

/**
 * Nahkämpfer auf dem Posten: Leitern in seinem Abschnitt (oberes Ende höchstens postGuardRadius vom Posten) ansteuern,
 * damit er sie umstößt (updateLadders). true = er ist dorthin unterwegs oder steht dort.
 */
export function ladderDuty(w: World, u: SUnit, px: number, py: number): boolean {
  const list = w.s.ladders;
  if (!list?.length) return false;
  const nav = w.nav, comp = nav.comp[0], mine = comp[unitNode(w, u)];
  let best: Ladder | null = null, bd = Infinity;
  for (const l of list) {
    if (l.state !== "steht" || dist(px, py, l.wx + 0.5, l.wy + 0.5) > TUNING.postGuardRadius) continue;
    if (mine >= 0 && comp[nav.node(1, l.wx, l.wy)] !== mine) continue;
    const d = dist(u.x, u.y, l.wx + 0.5, l.wy + 0.5);
    if (d < bd) { bd = d; best = l; }
  }
  if (!best) return false;
  u.ai.sortie = true;
  if (bd <= SIEGE.ladderPushReach * 0.8) { setAnim(u, u.anim === "angriff" ? u.anim : "stehen"); return true; }
  const r = travel(w, u, tileGoal(best.wx, best.wy, 1, 0));
  return r !== "unreachable";
}

// ---------------------------------------------------------------- Rammbock
export const isVehicle = (u: { key: SUnit["key"] }): boolean => !!UNITS[u.key].vehicle;

/** Mannschaft eines Rammbocks: alle lebenden Sturmknechte mit ai.ram = seine ID; near = nur die bei ihm. */
export function crewOf(w: World, ram: SUnit, near = false): SUnit[] {
  return w.s.units.filter((c) => !c.dead && c.ai.ram === ram.id && (!near || dist(c.x, c.y, ram.x, ram.y) <= SIEGE.ramCrewReach));
}

/** Ziel des Rammbocks: das nächste Tor, sonst die nächste Befestigung, sonst irgendein Gebäude (übersprungene zuletzt). */
function chooseRamTarget(w: World, u: SUnit): void {
  const ai = u.ai;
  const cur = ai.targetB ? w.buildings.get(ai.targetB) : undefined;
  if (cur && cur.team !== u.team) return;
  const rank = (b: SBuilding) => (BUILDINGS[b.key].gate ? 0 : BUILDINGS[b.key].category === "befestigung" ? 1 : 2) + (b.id === ai.skipB ? 3 : 0);
  let best = 0, bk = Infinity, bd = Infinity;
  for (const b of w.s.buildings) {
    if (b.team === u.team || BUILDINGS[b.key].ditch || BUILDINGS[b.key].road) continue; // Gräben, Wege und Brücken sind kein Ziel
    const [cx, cy] = center(b.key, b.x, b.y, b.o);
    const k = rank(b), d = dist(cx, cy, u.x, u.y);
    if (k < bk || (k === bk && d < bd)) { bk = k; bd = d; best = b.id; }
  }
  ai.targetB = best;
}

/** Kann der Rammbock ein mögliches Ziel überhaupt erreichen? Füllt einmal das Bodenraster (Bodenmodus mit Einreißen:
 *  nur Graben, Gelände und Ebenenwechsel sperren) von seinem Feld aus; nur aufgerufen, wenn eine Suche scheiterte. */
export function ramHasReachableTarget(w: World, u: SUnit): boolean {
  const nav = w.nav, W = w.s.w, H = w.s.h;
  const sx = Math.min(W - 1, Math.max(0, Math.floor(u.x))), sy = Math.min(H - 1, Math.max(0, Math.floor(u.y)));
  const seen = new Uint8Array(W * H), q = new Int32Array(W * H);
  let qh = 0, qt = 0;
  seen[sy * W + sx] = 1; q[qt++] = sy * W + sx;
  while (qh < qt) {
    const i = q[qh++], x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (seen[j] || nav.pass(nav.node(0, nx, ny), u.team, true, true) < 0) continue;
      seen[j] = 1; q[qt++] = j;
    }
  }
  for (const b of w.s.buildings) {
    if (b.team === u.team || BUILDINGS[b.key].ditch || BUILDINGS[b.key].road) continue;
    const [fw, fh] = footprint(b.key, b.o);
    for (let y = Math.max(0, b.y - 1); y <= Math.min(H - 1, b.y + fh); y++) {
      for (let x = Math.max(0, b.x - 1); x <= Math.min(W - 1, b.x + fw); x++) if (seen[y * W + x]) return true;
    }
  }
  return false;
}

/** Rammbock: fährt mit Mannschaft zum Tor (Bodenmodus) und stößt es ein; ohne Mannschaft steht er, ganz ohne ist er aufgegeben. */
export function ramAct(w: World, u: SUnit): void {
  const ai = u.ai;
  const crew = crewOf(w, u);
  if (!crew.length) {
    kill(w, u);
    w.msg("Der Rammbock ist aufgegeben: Seine Mannschaft ist gefallen.", "kampf", "ramme-weg", 10);
    return;
  }
  const near = crew.filter((c) => dist(c.x, c.y, u.x, u.y) <= SIEGE.ramCrewReach).length;
  if (--ai.think <= 0) {
    ai.think = TPS;
    if (!ai.retreat && u.hp < TUNING.retreatHp * u.maxHp) {
      ai.retreat = true; ai.targetB = 0; stop(u);
      w.meta.raidLosses = (w.meta.raidLosses ?? 0) + 1;
      w.msg("Der Rammbock wird zurückgezogen!", "kampf", "ramme-zurueck", 15);
    }
    if (!ai.retreat) chooseRamTarget(w, u);
  }
  if (!near) { setAnim(u, "stehen"); return; }
  if (ai.retreat) {
    const [sx, sy] = w.meta.raidSpawn;
    const r = travel(w, u, { ...tileGoal(sx, sy, 0, 1), ground: true });
    const edge = u.x < 1 || u.y < 1 || u.x > w.s.w - 1 || u.y > w.s.h - 1;
    // Am Anmarschpunkt bzw. Kartenrand verlässt er die Karte (ohne Rückweg ebenso, sonst endete die Welle nie);
    // seine Mannschaft zieht mit ihm ab
    if (r === "arrived" || r === "unreachable" || edge) {
      for (const c of crew) { c.ai.ram = 0; c.ai.retreat = true; c.ai.target = 0; c.ai.targetB = 0; stop(c); }
      vanish(u);
    }
    return;
  }
  const b = ai.targetB ? w.buildings.get(ai.targetB) : undefined;
  if (!b) { setAnim(u, "stehen"); return; }
  if (inRangeBuilding(u, b)) { strikeBuilding(w, u, b); return; }
  const r = travel(w, u, { ...goalAround(b, true), ground: true });
  if (r === "unreachable") {
    ai.skipB = b.id; ai.targetB = 0;
    // Versperrt ein Graben ohne Bresche jeden Weg, zieht er ab, statt für immer davor zu stehen (die Welle endet)
    if (!ramHasReachableTarget(w, u)) {
      ai.retreat = true; stop(u);
      w.meta.raidLosses = (w.meta.raidLosses ?? 0) + 1;
      w.msg("Der Rammbock kommt nicht über den Graben und zieht ab!", "kampf", "ramme-zurueck", 15);
    }
    return;
  }
  if (r === "blocked") {
    const n = blockedNode(u);
    const x = n >= 0 ? w.buildingAt(w.nav.tileX(n), w.nav.tileY(n)) : undefined;
    if (x && x.team !== u.team) {
      if (inRangeBuilding(u, x)) strikeBuilding(w, u, x);
      else { const [cx, cy] = center(x.key, x.x, x.y, x.o); if (!stepToward(w, u, cx, cy, 0.5)) setAnim(u, "stehen"); }
    }
  }
}

/** Plätze der Mannschaft hinter dem Rammbock (entlang seiner Fahrtrichtung f, quer p). */
const CREW_SLOTS: [number, number][] = [[-1.05, 0.42], [-1.05, -0.42], [-1.55, 0], [-1.9, 0.45], [-1.9, -0.45]];

/** Mannschaft: hält ihren Platz hinter dem Rammbock und wehrt sich nur, wenn sie angegriffen wird. true = gehandelt. */
export function crewAct(w: World, u: SUnit): boolean {
  const ai = u.ai;
  if (!ai.ram) return false;
  const ram = w.aliveUnit(ai.ram);
  if (!ram) { ai.ram = 0; return false; }
  const foe = nearestEnemy(w, u, 1.6, (t) => meleeReachable(w, u, t));
  if (foe) {
    if (inRangeUnit(u, foe)) strikeUnit(w, u, foe);
    else if (!stepToward(w, u, foe.x, foe.y, 0.6)) setAnim(u, "stehen");
    return true;
  }
  const crew = crewOf(w, ram).sort((a, b) => a.id - b.id);
  const k = Math.max(0, crew.indexOf(u));
  const fl = Math.hypot(ram.fx, ram.fy) || 1, fx = ram.fx / fl, fy = ram.fy / fl;
  const [a, q] = CREW_SLOTS[k % CREW_SLOTS.length];
  const tx = ram.x + fx * a - fy * q, ty = ram.y + fy * a + fx * q;
  const d = dist(u.x, u.y, tx, ty);
  if (d > 3) {
    const r = travel(w, u, tileGoal(Math.floor(tx), Math.floor(ty), 0, 1));
    if (r === "unreachable") setAnim(u, "stehen");
    return true;
  }
  if (d > 0.04 && stepToward(w, u, tx, ty, 0)) { face(u, fx, fy); return true; }
  face(u, fx, fy);
  setAnim(u, ram.anim === "gehen" ? "gehen" : "stehen");
  return true;
}

/** Angreifer mit Belagerungsaufgabe (Gerät, Mannschaft, Leiter). true = erledigt, sonst handelt raiderAct normal. */
/**
 * Angreifer nehmen die Leiter, solange eine steht und sie über sie (und eine Treppe innen) ans Ziel kommen: Dann wird
 * nicht eingerissen (breach aus). Ohne stehende Leiter bleibt alles wie bisher (Welle 1 unverändert).
 */
export function viaLadder(w: World, u: SUnit, g: TravelGoal): TravelGoal {
  if (!g.breach || u.team !== 1 || !w.s.ladders?.some((l) => l.state === "steht")) return g;
  if (u.layer === 0 && u.z > 0.2 && w.nav.stairZ(u.x, u.y) < 0) return { ...g, breach: false }; // gerade auf der Leiter
  const fc = w.nav.comp[1][unitNode(w, u)];
  return fc >= 0 && w.nav.goalInComp(g, 1, fc) ? { ...g, breach: false } : g;
}

export function siegeAct(w: World, u: SUnit): boolean {
  if (isVehicle(u)) { ramAct(w, u); return true; }
  if (u.ai.ram && crewAct(w, u)) return true;
  return ladderCarrierAct(w, u);
}

// ---------------------------------------------------------------- Graben zuschütten
/** Angreifer vor einem Graben: hingehen und Erde hineinwerfen (Schaden = Füllmenge, combat.damageBuilding). */
export function fillDitch(w: World, u: SUnit, b: SBuilding): void {
  const [fw, fh] = footprint(b.key, b.o);
  const d = distToRect(u.x, u.y, b.x, b.y, b.x + fw, b.y + fh);
  if (d > 0.95) { const [cx, cy] = center(b.key, b.x, b.y, b.o); if (!stepToward(w, u, cx, cy, 0.5)) setAnim(u, "stehen"); return; }
  face(u, b.x + fw / 2 - u.x, b.y + fh / 2 - u.y);
  if (u.ai.cd > 0) { if (u.animT >= 0.6) setAnim(u, "stehen"); return; }
  u.ai.cd = Math.round(1.2 * TPS);
  u.ai.hitB = w.s.tick;
  setAnim(u, isRanged(u.key) ? "stehen" : "angriff", true);
  b.hp -= SIEGE.ditchFillPerStrike;
  b.ai.hitT = w.s.tick;
  w.msg("Angreifer schütten den Graben zu!", "kampf", "graben-zu", 20);
  if (b.hp <= 0) removeBuilding(w, b, "verfuellt");
}

// ---------------------------------------------------------------- Reparatur
/** Ware und Lebenspunkte je Stück einer Reparatur (häufigste Ware der Kosten; Bergfried: Kosten seines Ausbaus). */
export function repairPlan(b: Building): { good: Good; hp: number } {
  const def = BUILDINGS[b.key];
  const cost = def.levels?.[levelOf(b) - 1]?.upgrade?.cost ?? def.cost;
  const goods = goodsOf(cost);
  let good = REPAIR.fallback.good, pieces = REPAIR.fallback.pieces;
  if (goods.length) {
    good = goods.reduce((a, g) => (g[1] > a[1] ? g : a))[0];
    pieces = goods.reduce((a, g) => a + g[1], 0);
  }
  return { good, hp: Math.ceil(maxHpOf(b) / Math.max(2, pieces)) };
}

/** Soll das Gebäude jetzt repariert werden (beschädigt, Automatik an, kein Kampf in der Nähe, niemand dran)? */
export function wantsRepair(w: World, b: SBuilding): boolean {
  if (b.team !== 0 || b.built < 1 || b.upgrade || b.repairOff || BUILDINGS[b.key].ditch) return false;
  const rep = b.ai.repairer ? w.aliveUnit(b.ai.repairer) : undefined;
  if (rep && rep.ai.job?.k === "repair" && rep.ai.job.b === b.id) return false;
  b.ai.repairer = 0;
  if (maxHpOf(b) - b.hp < repairPlan(b).hp * 0.5) return false;
  return calm(w, b);
}

/** Kein Treffer seit REPAIR.calmSeconds und kein Angreifer in REPAIR.enemyRadius. */
export function calm(w: World, b: SBuilding): boolean {
  if (b.ai.hitT !== undefined && w.s.tick - b.ai.hitT < REPAIR.calmSeconds * TPS) return false;
  const [cx, cy] = center(b.key, b.x, b.y, b.o);
  let foe = false;
  w.grid.query(cx, cy, REPAIR.enemyRadius, (o) => { if (!foe && o.team === 1 && !o.dead) foe = true; });
  return !foe;
}

/**
 * Disponent: Reparaturen vergeben (höchstens REPAIR.crews gleichzeitig, eine je Gebäude). take = der freie Tagelöhner,
 * der Lager und Gebäude erreicht (economy.ts).
 */
export function dispatchRepairs(w: World, take: (x: number, y: number, ...goals: TravelGoal[]) => SUnit | null): void {
  let active = 0;
  for (const u of w.s.units) if (!u.dead && u.ai.job?.k === "repair") active++;
  for (const b of w.s.buildings) {
    if (active >= REPAIR.crews) return;
    if (!wantsRepair(w, b)) continue;
    const plan = repairPlan(b);
    if (available(w, plan.good) < 1) {
      w.msg(`Für Reparaturen fehlt ${plan.good === "stein" ? "Stein" : plan.good === "holz" ? "Holz" : "Material"} im Lager.`, "warnung", `reparatur-${plan.good}`, 60);
      continue;
    }
    const [cx, cy] = center(b.key, b.x, b.y, b.o);
    const ref = reserveTake(w, plan.good, cx, cy);
    if (!ref) continue;
    const u = take(cx, cy, goalSlot(w, ref.b, ref.k), goalAround(b));
    if (!u) { const s = ref.b.slots[ref.k]; s.reserved--; tidy(s); continue; }
    u.ai.job = { k: "repair", b: b.id, from: ref.b.id, slot: ref.k, good: plan.good, ph: 0, t: 0 };
    u.order = { t: "job" };
    b.ai.repairer = u.id;
    active++;
  }
}

/** Reparieren: Ware holen, sichtbar zum Gebäude tragen, dort hämmern, dann Lebenspunkte gutschreiben. */
export function runRepair(w: World, u: SUnit, j: RepairJob): void {
  const b = w.buildings.get(j.b);
  if (j.ph === 0) {
    const st = w.buildings.get(j.from);
    if (!b || !st || !st.slots[j.slot]) { releaseJob(w, u); return; }
    const r = storeVisit(w, u, st, j.slot);
    if (r === "unreachable") { releaseJob(w, u); u.ai.noJob = w.s.tick + 5 * TPS; return; }
    if (r !== "arrived") return;
    const s = st.slots[j.slot];
    s.amount--; s.reserved--; tidy(s);
    u.carry = j.good; j.ph = 1;
    return;
  }
  if (!b) { if (u.carry) carryBack(w, u); else endRepair(u); return; }
  if (j.ph === 1) {
    const r = travel(w, u, goalAround(b));
    if (r === "unreachable") { releaseJob(w, u, true); carryBack(w, u); return; }
    if (r !== "arrived") return;
    u.carry = null; // das Stück wird verbaut
    j.ph = 2; j.t = 0;
  }
  const [cx, cy] = center(b.key, b.x, b.y, b.o);
  face(u, cx - u.x, cy - u.y);
  setAnim(u, "bauen");
  if (++j.t < Math.round(REPAIR.seconds * workFactor(w.s, "bauen") * TPS)) return;
  b.hp = Math.min(maxHpOf(b), b.hp + repairPlan(b).hp);
  if (b.ai.repairer === u.id) b.ai.repairer = 0;
  endRepair(u);
}

function endRepair(u: SUnit): void {
  u.ai.job = null;
  u.order = { t: "idle" };
  setAnim(u, "stehen");
}

/** Auftrag zurückgeben (jobs.releaseJob): Reservierung im Lager und den Platz am Gebäude. */
export function releaseRepair(w: World, u: SUnit, j: RepairJob): void {
  const s = w.buildings.get(j.from)?.slots[j.slot];
  if (j.ph === 0 && s) { s.reserved--; tidy(s); }
  const b = w.buildings.get(j.b);
  if (b && b.ai.repairer === u.id) b.ai.repairer = 0;
}

/** Befehl „reparatur“: automatische Reparatur an- bzw. abschalten. */
export function setRepair(w: World, id: number, an: boolean): CommandResult {
  const b = w.buildings.get(id);
  if (!b || b.team !== 0) return { ok: false, reason: "Kein eigenes Gebäude" };
  if (BUILDINGS[b.key].ditch) return { ok: false, reason: "Ein Graben wird nicht repariert" };
  if (an) delete b.repairOff; else b.repairOff = true;
  return { ok: true, ids: [b.id] };
}

// ---------------------------------------------------------------- Heilung
/** Erholt sich die Figur gerade (verwundet, eigene Seite, seit HEAL.calmSeconds kein Treffer, kein Kampf)? */
export function healing(w: World, u: SUnit): boolean {
  if (u.team !== 0 || u.dead || u.inside || u.hp >= u.maxHp) return false;
  if (u.ai.hurtT !== undefined && w.s.tick - u.ai.hurtT < HEAL.calmSeconds * TPS) return false;
  return u.anim !== "angriff" && u.anim !== "schiessen";
}

/** Heilt nahe dem Bergfried oder der Kaserne schneller (HEAL.near, Abstand zum Grundriss)? */
export function nearHealer(w: World, u: SUnit): boolean {
  for (const b of w.s.buildings) {
    if (b.team !== u.team || b.built < 1 || !HEAL.near.includes(b.key)) continue;
    const [fw, fh] = footprint(b.key, b.o);
    if (distToRect(u.x, u.y, b.x, b.y, b.x + fw, b.y + fh) <= HEAL.nearRadius) return true;
  }
  return false;
}

/** Einmal je Sekunde: Verwundete in Ruhe heilen. */
export function updateHealing(w: World): void {
  for (const u of w.s.units) {
    if (!healing(w, u)) continue;
    u.hp = Math.min(u.maxHp, u.hp + (nearHealer(w, u) ? HEAL.nearPerSecond : HEAL.restPerSecond));
  }
}

// ---------------------------------------------------------------- Rotation (Darstellung, Tests)
/** Welt-Richtung, in die eine Leiter mit Ausrichtung o vom Fuß zur Mauer zeigt. */
export const ladderDir = (o: number): [number, number] => { const [x, y] = modelToWorld(0, 1, o); return [x + 0, y + 0]; };
