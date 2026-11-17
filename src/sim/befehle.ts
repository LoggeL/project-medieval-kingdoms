/**
 * Befehle und Steuerung der Soldaten (Briefing §7, ADR 0018): Formationen (Linie, Block, locker; Blickrichtung,
 * Fernkämpfer hinten, Ausweichen um Hindernisse), Angriffsmarsch, Patrouille, Rückzug, Haltung.
 *
 * Alle Befehle sind Simulationsbefehle (Command) und landen als UnitOrder bzw. Unit.stance/formation im Zustand,
 * also deterministisch und mit dem Spielstand gespeichert. Werte stehen in src/data/befehle.ts.
 */
import {
  COMMAND_TUNING, DEFAULT_FORMATION, FORMATIONS, FORMATION_ORDER, STANCES, UNITS,
  type FormationKey, type StanceKey,
} from "../data";
import { walkLayerAt } from "./build";
import { isRanged, meleeReachable, nearestEnemy, pickTarget } from "./combat";
import { entrance } from "./geom";
import { stop, tileGoal, travel, unitNode, type TravelGoal } from "./move";
import { chase, ownSoldiers } from "./military";
import { seatOf } from "./research";
import type { CommandResult, FormationSlot, OrderPoint, UnitOrder } from "./types";
import { face, type SUnit, type World } from "./world";

// ---------------------------------------------------------------- Formation
/** Felder um (0, 0) nach Abstand sortiert (Ersatzplätze), bis Radius r. */
const spirals = new Map<number, [number, number][]>();
function spiral(r: number): [number, number][] {
  let out = spirals.get(r);
  if (out) return out;
  out = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) out.push([dx, dy]);
  out.sort((a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2) || a[1] - b[1] || a[0] - b[0]);
  spirals.set(r, out);
  return out;
}

/** Formation einer Gruppe: die häufigste, bei Gleichstand die erste in FORMATION_ORDER. */
export function groupFormation(units: readonly SUnit[]): FormationKey {
  const n = new Map<FormationKey, number>();
  for (const u of units) { const f = u.formation ?? DEFAULT_FORMATION; n.set(f, (n.get(f) ?? 0) + 1); }
  let best: FormationKey = DEFAULT_FORMATION, bn = -1;
  for (const f of FORMATION_ORDER) if ((n.get(f) ?? 0) > bn) { bn = n.get(f) ?? 0; best = f; }
  return best;
}

/** Gewünschter Platz (Weltpunkt) je Einheit, ohne Rücksicht auf Hindernisse. */
export interface SlotWish { u: SUnit; x: number; y: number }

/**
 * Plätze der Formation um (cx, cy) mit Blickrichtung (fx, fy): Reihen quer zur Blickrichtung, vorn die Nahkämpfer,
 * dahinter in eigenen Reihen die Fernkämpfer. Innerhalb einer Reihe behält jeder seine Seite (Projektion auf die Querachse),
 * damit sich die Wege nicht kreuzen; die Vordersten kommen in die vorderste Reihe.
 */
export function formationWishes(units: readonly SUnit[], key: FormationKey, cx: number, cy: number, fx: number, fy: number): SlotWish[] {
  const def = FORMATIONS[key];
  const n = units.length;
  if (!n) return [];
  const len = Math.hypot(fx, fy) || 1;
  const ax = fx / len, ay = fy / len;          // vorn
  const rx = -ay, ry = ax;                      // quer (rechts in Blickrichtung)
  const cols = Math.max(1, Math.min(n, Math.ceil(Math.sqrt(n * def.aspect))));
  const along = (u: SUnit) => u.x * ax + u.y * ay;
  const side = (u: SUnit) => u.x * rx + u.y * ry;
  const byFront = (a: SUnit, b: SUnit) => along(b) - along(a) || a.id - b.id;
  const melee = units.filter((u) => !isRanged(u.key)).sort(byFront);
  const ranged = units.filter((u) => isRanged(u.key)).sort(byFront);
  const rows: SUnit[][] = [];
  for (const group of [melee, ranged]) for (let i = 0; i < group.length; i += cols) rows.push(group.slice(i, i + cols));
  const sp = def.spacing, R = rows.length;
  const out: SlotWish[] = [];
  rows.forEach((row, d) => {
    row.sort((a, b) => side(a) - side(b) || a.id - b.id);
    const depth = ((R - 1) / 2 - d) * sp;
    row.forEach((u, j) => {
      const lat = (j - (row.length - 1) / 2) * sp;
      out.push({ u, x: cx + rx * lat + ax * depth, y: cy + ry * lat + ay * depth });
    });
  });
  return out;
}

/** Ergebnis der Platzwahl: Knoten je Einheit. */
export interface Placement { u: SUnit; node: number }

/**
 * Plätze für einen Bewegungsbefehl zum Tile (x, y). Am Boden in Formation (fx/fy = Blickrichtung, sonst
 * Marschrichtung vom Schwerpunkt der Gruppe), auf dem Wehrgang der Reihe nach ab dem Zielfeld (der Gang ist schmal).
 * Ein blockierter oder unerreichbarer Platz (Gebäude, Wasser, Baum, andere Komponente) weicht auf das nächste freie
 * Feld aus; jedes Feld bekommt höchstens eine Einheit.
 */
export function placeGroup(w: World, units: readonly SUnit[], x: number, y: number, fx?: number, fy?: number, key?: FormationKey): Placement[] {
  const nav = w.nav;
  const layer = walkLayerAt(w, x, y);
  const taken = new Set<number>();
  const out: Placement[] = [];
  let wishes: SlotWish[];
  if (layer > 0) wishes = units.map((u) => ({ u, x: x + 0.5, y: y + 0.5 }));
  else {
    let dx = fx ?? 0, dy = fy ?? 0;
    if (!dx && !dy) {
      let sx = 0, sy = 0;
      for (const u of units) { sx += u.x; sy += u.y; }
      dx = x + 0.5 - sx / units.length; dy = y + 0.5 - sy / units.length;
      if (Math.hypot(dx, dy) < 0.5) { dx = units[0].fx; dy = units[0].fy; }
      if (!dx && !dy) dy = 1;
    }
    wishes = formationWishes(units, key ?? groupFormation(units), x + 0.5, y + 0.5, dx, dy);
  }
  const free = (n: number, c: number) => !taken.has(n) && nav.open(n, 0) && !nav.linkOnly[n] && (c < 0 || nav.comp[0][n] === c);
  for (const s of wishes) {
    const c = nav.comp[0][unitNode(w, s.u)];
    const tx0 = Math.floor(s.x), ty0 = Math.floor(s.y);
    let target = -1;
    for (const [ox, oy] of spiral(COMMAND_TUNING.slotSearch)) {
      const tx = tx0 + ox, ty = ty0 + oy;
      if (!w.inMap(tx, ty)) continue;
      const n = nav.node(layer, tx, ty);
      if (free(n, c)) { target = n; break; }
    }
    // weit verstreut oder dicht umbaut: nächstes Feld der Komponente (darf doppelt belegt sein)
    if (target < 0 && c >= 0) target = nav.nearestInComp(0, c, Math.min(w.s.w - 1, Math.max(0, tx0)), Math.min(w.s.h - 1, Math.max(0, ty0)), layer);
    if (target < 0) continue;
    taken.add(target);
    out.push({ u: s.u, node: target });
  }
  return out;
}

/** Vorschau für die Oberfläche (Rechtsziehen): dieselbe Platzwahl wie der Befehl. */
export function planFormation(w: World, ids: number[], x: number, y: number, fx?: number, fy?: number): FormationSlot[] {
  const units = ownSoldiers(w, ids);
  if (!units.length || !w.inMap(x, y)) return [];
  const nav = w.nav;
  return placeGroup(w, units, x, y, fx, fy).map((p) => ({ id: p.u.id, x: nav.tileX(p.node), y: nav.tileY(p.node), layer: nav.layerOf(p.node), z: nav.z[p.node] }));
}

/** Langsamstes Grundtempo der Gruppe (Formation bleibt beisammen); einzeln kein Limit. */
function groupPace(units: readonly SUnit[]): number | undefined {
  if (units.length < 2) return undefined;
  return Math.min(...units.map((u) => UNITS[u.key].speed));
}

function norm(fx?: number, fy?: number): [number, number] | null {
  const l = Math.hypot(fx ?? 0, fy ?? 0);
  return l > 1e-6 ? [round3(fx! / l), round3(fy! / l)] : null;
}
const round3 = (v: number) => Math.round(v * 1000) / 1000;

function reset(u: SUnit): void {
  u.ai.target = 0; u.ai.sortie = false;
  // löschen statt undefined: gleiche Feldreihenfolge nach dem Laden (Spielstand bytegleich)
  delete u.ai.anchor; delete u.ai.pfail;
  stop(u);
}

// ---------------------------------------------------------------- Befehle
/** Bewegen bzw. Angriffsmarsch in Formation. */
export function cmdGroupMove(w: World, ids: number[], x: number, y: number, fx: number | undefined, fy: number | undefined, kind: "move" | "amove"): CommandResult {
  const units = ownSoldiers(w, ids);
  if (!units.length) return { ok: false, reason: "Keine Soldaten ausgewählt" };
  if (!w.inMap(x, y)) return { ok: false, reason: "Außerhalb der Karte" };
  const dir = norm(fx, fy);
  const nav = w.nav, pace = groupPace(units);
  const moved: number[] = [];
  for (const p of placeGroup(w, units, x, y, dir?.[0], dir?.[1])) {
    const o: Extract<UnitOrder, { t: "move" | "amove" }> = { t: kind, x: nav.tileX(p.node), y: nav.tileY(p.node), layer: nav.layerOf(p.node) };
    if (dir) { o.fx = dir[0]; o.fy = dir[1]; }
    if (pace) o.pace = pace;
    p.u.order = o;
    reset(p.u);
    moved.push(p.u.id);
  }
  return moved.length ? { ok: true, ids: moved } : { ok: false, reason: "Dort kommt niemand hin" };
}

/**
 * Patrouille: vom Standort (Schwerpunkt der Gruppe) über die Wegmarken und zurück, in Formation. Jede Einheit bekommt
 * ihre eigenen Wegpunkte (ihr Platz in der Formation an jeder Marke). Die Formation behält dabei die Ausrichtung des
 * ersten Wegstücks: So sind alle Wege gleich lang und die Gruppe bleibt im gemeinsamen Tempo beisammen.
 */
export function cmdPatrol(w: World, ids: number[], pts: { x: number; y: number }[]): CommandResult {
  const units = ownSoldiers(w, ids);
  if (!units.length) return { ok: false, reason: "Keine Soldaten ausgewählt" };
  const marks = pts.map((p) => ({ x: Math.floor(p.x), y: Math.floor(p.y) })).filter((p) => w.inMap(p.x, p.y)).slice(0, COMMAND_TUNING.patrolPoints);
  if (!marks.length) return { ok: false, reason: "Außerhalb der Karte" };
  let sx = 0, sy = 0;
  for (const u of units) { sx += u.x; sy += u.y; }
  const start = { x: Math.floor(sx / units.length), y: Math.floor(sy / units.length) };
  const route = [start, ...marks];
  let fx = marks[0].x - start.x, fy = marks[0].y - start.y;
  if (!fx && !fy) { fx = units[0].fx; fy = units[0].fy; }
  if (!fx && !fy) fy = 1;
  const nav = w.nav;
  const per = new Map<number, OrderPoint[]>(units.map((u) => [u.id, []]));
  for (const p of route) {
    for (const pl of placeGroup(w, units, p.x, p.y, fx, fy)) per.get(pl.u.id)!.push([nav.tileX(pl.node), nav.tileY(pl.node), nav.layerOf(pl.node)]);
  }
  const pace = groupPace(units);
  const ok: number[] = [];
  for (const u of units) {
    const list = per.get(u.id)!;
    if (list.length !== route.length) continue;
    const o: Extract<UnitOrder, { t: "patrol" }> = { t: "patrol", pts: list, i: 1 };
    if (pace) o.pace = pace;
    u.order = o;
    reset(u);
    ok.push(u.id);
  }
  return ok.length ? { ok: true, ids: ok } : { ok: false, reason: "Dort kommt niemand hin" };
}

/** Sammelpunkt für den Rückzug: vor der Tür des Bergfrieds, ohne Bergfried der Sammelplatz der Siedlung. */
export function rallyPoint(w: World): [number, number] {
  const seat = seatOf(w.s);
  if (seat) {
    const [ex, ey] = entrance(seat.key, seat.x, seat.y, seat.o);
    if (w.inMap(ex, ey)) return [ex, ey];
  }
  return [w.meta.camp[0], w.meta.camp[1]];
}

export function cmdRetreat(w: World, ids: number[]): CommandResult {
  const units = ownSoldiers(w, ids);
  if (!units.length) return { ok: false, reason: "Keine Soldaten ausgewählt" };
  const [rx, ry] = rallyPoint(w);
  // am Sammelpunkt mit dem Gesicht zur Gefahr (woher sie kommen)
  let sx = 0, sy = 0;
  for (const u of units) { sx += u.x; sy += u.y; }
  const fx = sx / units.length - (rx + 0.5), fy = sy / units.length - (ry + 0.5);
  const nav = w.nav, moved: number[] = [];
  for (const p of placeGroup(w, units, rx, ry, fx || undefined, fy || 1, "block")) {
    if (nav.layerOf(p.node) !== 0) continue;
    p.u.order = { t: "retreat", x: nav.tileX(p.node), y: nav.tileY(p.node) };
    reset(p.u);
    moved.push(p.u.id);
  }
  return moved.length ? { ok: true, ids: moved } : { ok: false, reason: "Kein Weg zum Bergfried" };
}

export function cmdStance(w: World, ids: number[], stance: StanceKey): CommandResult {
  if (!STANCES[stance]) return { ok: false, reason: "Unbekannte Haltung" };
  const units = ownSoldiers(w, ids);
  if (!units.length) return { ok: false, reason: "Keine Soldaten ausgewählt" };
  for (const u of units) {
    u.stance = stance;
    // Halten (H) ist dieselbe Haltung; wer eine andere wählt, darf wieder losgehen
    if (stance !== "stellung" && u.order.t === "hold") u.order = { t: "idle" };
    delete u.ai.anchor;
    if (stance === "stellung" && u.order.t === "idle") { u.ai.target = 0; stop(u); }
  }
  return { ok: true, ids: units.map((u) => u.id) };
}

/**
 * Formation setzen. Wer steht (untätig oder hält) bzw. in Formation läuft, stellt sich sofort neu auf: Stehende um
 * ihren Schwerpunkt mit ihrer Blickrichtung, Laufende um ihr gemeinsames Ziel.
 */
export function cmdFormation(w: World, ids: number[], key: FormationKey): CommandResult {
  if (!FORMATIONS[key]) return { ok: false, reason: "Unbekannte Formation" };
  const units = ownSoldiers(w, ids);
  if (!units.length) return { ok: false, reason: "Keine Soldaten ausgewählt" };
  for (const u of units) u.formation = key;
  const standing = units.filter((u) => (u.order.t === "idle" || u.order.t === "hold") && u.layer === 0 && !u.inside);
  const marching = { move: [] as SUnit[], amove: [] as SUnit[] };
  for (const u of units) if ((u.order.t === "move" || u.order.t === "amove") && u.order.layer === 0) marching[u.order.t].push(u);
  const regroup = (list: SUnit[], kind: "move" | "amove", cx: number, cy: number, fx?: number, fy?: number) => {
    if (list.length < 2) return;
    const held = new Set(list.filter((u) => u.order.t === "hold").map((u) => u.id));
    cmdGroupMove(w, list.map((u) => u.id), cx, cy, fx, fy, kind);
    // Wer hielt, hält am neuen Platz weiter (Haltung „Stellung halten“)
    for (const u of list) if (held.has(u.id)) u.stance = "stellung";
  };
  if (standing.length > 1) {
    let sx = 0, sy = 0, fx = 0, fy = 0;
    for (const u of standing) { sx += u.x; sy += u.y; const l = Math.hypot(u.fx, u.fy) || 1; fx += u.fx / l; fy += u.fy / l; }
    regroup(standing, "move", Math.floor(sx / standing.length), Math.floor(sy / standing.length), fx || standing[0].fx, fy || standing[0].fy);
  }
  for (const kind of ["move", "amove"] as const) {
    const list = marching[kind];
    if (!list.length) continue;
    let sx = 0, sy = 0;
    for (const u of list) { const o = u.order as Extract<UnitOrder, { t: "move" | "amove" }>; sx += o.x; sy += o.y; }
    const o0 = list[0].order as Extract<UnitOrder, { t: "move" | "amove" }>;
    regroup(list, kind, Math.round(sx / list.length), Math.round(sy / list.length), o0.fx, o0.fy);
  }
  return { ok: true, ids: units.map((u) => u.id) };
}

// ---------------------------------------------------------------- Verhalten
/**
 * Unterwegs kämpfen (Angriffsmarsch, Patrouille): Gegner im Umkreis COMMAND_TUNING.marchEngage angreifen und
 * verfolgen, solange er höchstens marchLeash Felder von dem Punkt entfernt ist, an dem der Kampf begann (ai.anchor);
 * ein fliehender Gegner zieht den Trupp also nicht beliebig weit vom Marschweg weg. true = kämpft bzw. verfolgt gerade
 * (dann nicht weiterlaufen).
 */
function engageOnMarch(w: World, u: SUnit): boolean {
  const ai = u.ai;
  const t = w.aliveUnit(ai.target);
  if (t && t.team !== u.team) {
    const a = ai.anchor ?? [u.x, u.y, u.layer];
    if (Math.hypot(t.x - a[0], t.y - a[1]) <= COMMAND_TUNING.marchLeash && chase(w, u, t)) return true;
    ai.target = 0; stop(u);
  } else ai.target = 0;
  if (ai.anchor) delete ai.anchor;
  if ((w.s.tick + u.id) % 10 !== 0) return false;
  const e = isRanged(u.key)
    ? pickTarget(w, u, COMMAND_TUNING.marchEngage, () => true)
    : nearestEnemy(w, u, COMMAND_TUNING.marchEngage, (x) => meleeReachable(w, u, x));
  if (!e) return false;
  ai.target = e.id;
  ai.anchor = [u.x, u.y, u.layer];
  if (chase(w, u, e)) return true;
  ai.target = 0;
  delete ai.anchor;
  return false;
}

const goalOf = (x: number, y: number, layer: number): TravelGoal => tileGoal(x, y, layer, 0);

/** Angriffsmarsch, Patrouille und Rückzug; false = kein Befehl dieser Art. */
export function commandAct(w: World, u: SUnit): boolean {
  const o = u.order;
  switch (o.t) {
    case "amove": {
      if (engageOnMarch(w, u)) return true;
      const r = travel(w, u, goalOf(o.x, o.y, o.layer));
      if (r === "arrived" || r === "unreachable") {
        if (r === "arrived" && (o.fx || o.fy)) face(u, o.fx!, o.fy!);
        u.order = { t: "idle" };
      }
      return true;
    }
    case "patrol": {
      if (engageOnMarch(w, u)) return true;
      const p = o.pts[o.i % o.pts.length];
      const r = travel(w, u, goalOf(p[0], p[1], p[2]));
      if (r === "arrived") { o.i = (o.i + 1) % o.pts.length; u.ai.pfail = 0; }
      else if (r === "unreachable") {
        // Marke nicht (mehr) erreichbar: die nächste versuchen; sind es alle, endet die Patrouille
        u.ai.pfail = (u.ai.pfail ?? 0) + 1;
        if (u.ai.pfail >= o.pts.length) { u.order = { t: "idle" }; u.ai.pfail = 0; }
        else o.i = (o.i + 1) % o.pts.length;
      }
      return true;
    }
    case "retreat": {
      // ohne zu kämpfen: kein Ziel, kein Zurückschlagen
      u.ai.target = 0;
      const r = travel(w, u, goalOf(o.x, o.y, 0));
      if (r === "arrived" || r === "unreachable") u.order = { t: "idle" };
      return true;
    }
    default: return false;
  }
}

/** Tempo-Faktor der Laufanimation: schneller beim Rückzug, langsamer, wenn die Formation auf den Langsamsten wartet. */
export function animRate(u: SUnit): number {
  const o = u.order;
  if (o.t === "retreat") return COMMAND_TUNING.retreatSpeed;
  if ((o.t === "move" || o.t === "amove" || o.t === "patrol") && o.pace && u.anim === "gehen") return Math.min(1, o.pace / UNITS[u.key].speed);
  return 1;
}

/** Tempo-Faktor beim Laufen (move.speedOf). */
export function orderSpeed(u: SUnit, base: number): number {
  const o = u.order;
  if (o.t === "retreat") return base * COMMAND_TUNING.retreatSpeed;
  if ((o.t === "move" || o.t === "amove" || o.t === "patrol") && o.pace) return Math.min(base, o.pace);
  return base;
}
