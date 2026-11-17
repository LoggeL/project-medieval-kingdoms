/**
 * Bewegung entlang von Pfaden. Einheiten laufen von Knotenmitte zu Knotenmitte, die Höhe z gleitet linear
 * zur Höhe des nächsten Knotens (so steigt sie sichtbar entlang der Treppe). Pfadsuchen sind pro Tick
 * begrenzt (World.budget); wer keine bekommt, wartet einen Tick.
 */
import { LIFE, SIEGE, UNITS } from "../data";
import { BUILDINGS } from "../data";
import { entrance, footprint } from "./geom";
import { carryFactor } from "./research";
import { MIN_COST } from "./nav";
import type { Goal } from "./nav";
import { TPS, face, setAnim, type SBuilding, type SUnit, type World } from "./world";

export interface TravelGoal extends Goal {
  /** Genaue Endposition (z. B. Posten), sonst Tile-Mitte. */
  endX?: number; endY?: number;
  /** Belagerungsmodus: Gebäude sind (teuer) passierbar, travel meldet "blocked" davor. */
  breach?: boolean;
  /** Bodenmodus (Belagerungsgerät): keine Treppen, Leitern und Turmtüren, kein Graben (ADR 0017). */
  ground?: boolean;
}

export type TravelResult = "arrived" | "moving" | "waiting" | "unreachable" | "blocked";

export function goalKey(g: TravelGoal): string {
  return `${g.layer},${g.x0},${g.y0},${g.x1},${g.y1},${g.d}` + (g.endX !== undefined ? `@${g.endX},${g.endY}` : "") + (g.breach ? "b" : "") + (g.ground ? "g" : "");
}

export function tileGoal(x: number, y: number, layer = 0, d = 0): TravelGoal {
  return { layer, x0: x, y0: y, x1: x, y1: y, d };
}

/** Knoten, auf dem die Einheit gerade steht. */
export function unitNode(w: World, u: SUnit): number {
  const x = Math.min(w.s.w - 1, Math.max(0, Math.floor(u.x)));
  const y = Math.min(w.s.h - 1, Math.max(0, Math.floor(u.y)));
  return w.nav.node(u.layer, x, y);
}

export function stop(u: SUnit): void {
  u.ai.path = null; u.ai.pi = 0; u.ai.goal = "";
}

/**
 * Einen Tick in Richtung Ziel gehen. Gibt "arrived" zurück, sobald das Ziel erreicht ist (und bleibt dabei,
 * solange dasselbe Ziel angefragt wird).
 */
export function travel(w: World, u: SUnit, g: TravelGoal): TravelResult {
  const ai = u.ai, nav = w.nav;
  const key = goalKey(g);
  if (ai.goal !== key) { ai.goal = key; ai.path = null; ai.pi = 0; ai.wait = 0; }
  if (ai.path && ai.navV !== w.meta.navVersion) {
    // Raster hat sich geändert: Rest des Wegs prüfen
    ai.navV = w.meta.navVersion;
    for (let i = ai.pi; i < ai.path.length; i++) {
      // auch Diagonalen, an deren Ecke inzwischen etwas steht (neue Baustelle, nachgerutschter Fels)
      if (nav.pass(ai.path[i], u.team, !!g.breach, !!g.ground) < 0 || (i > 0 && nav.cutsCorner(ai.path[i - 1], ai.path[i], u.team))) { ai.path = null; break; }
    }
  }
  if (!ai.path) {
    if (ai.wait > 0) { ai.wait--; setAnim(u, "stehen"); return "waiting"; }
    if (w.budget <= 0) { setAnim(u, "stehen"); return "waiting"; }
    w.budget--;
    const from = unitNode(w, u);
    let path = nav.route(u.team, !!g.breach, from, g, !!g.ground);
    if (!path && !nav.linkOnly[from] && nav.pass(from, u.team, !!g.breach) < 0) {
      // Steht auf einem gesperrten Tile (z. B. neue Baustelle): erst zum nächsten freien Tile, von dort weiter
      const free = nav.nearestOpen(u.team, nav.tileX(from), nav.tileY(from), u.layer);
      const rest = free >= 0 ? nav.route(u.team, !!g.breach, free, g, !!g.ground) : null;
      if (rest) path = [free, ...rest];
    }
    if (!path) { ai.wait = 2 * TPS; setAnim(u, "stehen"); return "unreachable"; }
    ai.path = path; ai.pi = 0; ai.navV = w.meta.navVersion;
    ai.hasEnd = g.endX !== undefined; ai.endX = g.endX ?? 0; ai.endY = g.endY ?? 0;
  }
  // Belagerung: vor einem Gebäude stehen bleiben, das erst eingerissen werden muss
  if (g.breach && ai.pi < ai.path.length) {
    const n = ai.path[ai.pi];
    if (!nav.open(n, u.team)) {
      const cx = nav.tileX(n) + 0.5, cy = nav.tileY(n) + 0.5;
      if (Math.hypot(cx - u.x, cy - u.y) <= 1.5) { setAnim(u, "stehen"); return "blocked"; }
    }
  }
  return advance(w, u) ? "arrived" : "moving";
}

/** Nächster Knoten, an dem eine Einheit im Belagerungsmodus steht (oder −1). */
export function blockedNode(u: SUnit): number {
  const ai = u.ai;
  return ai.path && ai.pi < ai.path.length ? ai.path[ai.pi] : -1;
}

/**
 * Einheiten am Boden, die auf einem nun gesperrten Tile stehen (neue Baustelle, Tor statt Mauer), auf den nächsten
 * freien Tile schieben, damit sie nicht im Grundriss festsitzen. Nach nav.rebuild aufrufen.
 */
export function evictUnits(w: World): void {
  const nav = w.nav;
  for (const u of w.s.units) {
    // wer gerade an einer Leiter klettert (Höhe ohne Treppe), bleibt, wo er ist
    if (u.dead || u.layer !== 0 || u.inside || (u.z > 0.2 && nav.stairZ(u.x, u.y) < 0)) continue;
    const n = unitNode(w, u);
    if (nav.linkOnly[n] || nav.open(n, u.team)) continue;
    const free = nav.nearestOpen(u.team, nav.tileX(n), nav.tileY(n), 0);
    if (free < 0) continue;
    const tx = nav.tileX(free), ty = nav.tileY(free);
    u.x = tx + Math.min(0.85, Math.max(0.15, u.x - tx));
    u.y = ty + Math.min(0.85, Math.max(0.15, u.y - ty));
    u.z = 0;
    stop(u);
  }
}

/** Läuft den Weg einen Tick weiter. true = Ende erreicht. */
function advance(w: World, u: SUnit): boolean {
  const ai = u.ai, nav = w.nav, path = ai.path!;
  let budget = speedOf(w, u) / TPS;
  // An der Sturmleiter (Boden ↔ Wehrgang ohne Treppe) geht es langsam hinauf und hinunter
  if (ai.pi < path.length && climbing(w, u, path[ai.pi])) budget *= SIEGE.climbFactor;
  while (budget > 1e-6) {
    let tx: number, ty: number, tz: number, layer: number;
    if (ai.pi < path.length) {
      const n = path[ai.pi];
      layer = nav.layerOf(n);
      tz = nav.z[n];
      if (ai.pi === path.length - 1 && ai.hasEnd) { tx = ai.endX; ty = ai.endY; }
      else { tx = nav.tileX(n) + 0.5; ty = nav.tileY(n) + 0.5; }
    } else if (ai.hasEnd && (Math.abs(u.x - ai.endX) > 1e-6 || Math.abs(u.y - ai.endY) > 1e-6)) {
      tx = ai.endX; ty = ai.endY; tz = u.z; layer = u.layer;
    } else break;
    const dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy);
    face(u, dx, dy);
    if (d <= budget) {
      u.x = tx; u.y = ty; u.z = tz; u.layer = layer;
      budget -= d;
      if (ai.pi < path.length) ai.pi++;
      else break;
    } else {
      const f = budget / d;
      u.x += dx * f; u.y += dy * f; u.z += (tz - u.z) * f;
      budget = 0;
    }
  }
  // Auf der Treppe folgt die Höhe den Stufen
  if (u.layer <= 1) { const sz = nav.stairZ(u.x, u.y); if (sz >= 0) u.z = sz; }
  const done = ai.pi >= path.length && (!ai.hasEnd || (Math.abs(u.x - ai.endX) < 1e-6 && Math.abs(u.y - ai.endY) < 1e-6));
  setAnim(u, done ? "stehen" : "gehen");
  return done;
}

/** Führt der Schritt zum Knoten n über eine Sturmleiter (Wechsel Boden ↔ Wehrgang, nicht auf einer Treppe)? */
export function climbing(w: World, u: SUnit, n: number): boolean {
  const nav = w.nav, l = nav.layerOf(n);
  if (l === u.layer || l + u.layer !== 1) return false;
  return nav.stairZ(u.x, u.y) < 0 && nav.stairZ(nav.tileX(n) + 0.5, nav.tileY(n) + 0.5) < 0;
}

/** Felder pro Sekunde am aktuellen Ort (Wege schneller, Wald und Fels langsamer). */
export function speedOf(w: World, u: SUnit): number {
  const base = UNITS[u.key].speed * (u.carry && u.team === 0 ? carryFactor(w.s) : 1) * (u.run ? LIFE.run.factor : 1);
  if (u.layer > 0) return base;
  const x = Math.floor(u.x), y = Math.floor(u.y);
  if (!w.inMap(x, y)) return base;
  const c = w.nav.cost[y * w.s.w + x];
  return base * Math.min(1 / MIN_COST, Math.max(0.55, 1 / c)); // Pflaster bis 1 / MIN_COST (ADR 0015)
}

/** Direkt (ohne Pfad) auf einen Punkt zugehen; nur für kurze, freie Strecken auf derselben Ebene. false = versperrt. */
export function stepToward(w: World, u: SUnit, tx: number, ty: number, keep = 0): boolean {
  const dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy);
  face(u, dx, dy);
  if (d <= keep) { setAnim(u, "stehen"); return true; }
  const step = Math.min(d - keep, speedOf(w, u) / TPS);
  const nx = u.x + (dx / d) * step, ny = u.y + (dy / d) * step;
  const fx = Math.floor(nx), fy = Math.floor(ny);
  if (!w.inMap(fx, fy) || !w.nav.open(w.nav.node(u.layer, fx, fy), u.team)) return false;
  // nicht diagonal zwischen zwei Hindernissen hindurch
  if (fx !== Math.floor(u.x) && fy !== Math.floor(u.y)
    && (!w.nav.open(w.nav.node(u.layer, fx, Math.floor(u.y)), u.team) || !w.nav.open(w.nav.node(u.layer, Math.floor(u.x), fy), u.team))) return false;
  u.x = nx; u.y = ny;
  setAnim(u, "gehen");
  return true;
}

/** Freie Sicht/Strecke am Boden bzw. auf derselben Ebene (Raster abtasten). */
export function lineClear(w: World, u: SUnit, tx: number, ty: number): boolean {
  const d = Math.hypot(tx - u.x, ty - u.y);
  const steps = Math.ceil(d * 2);
  for (let i = 1; i <= steps; i++) {
    const x = u.x + ((tx - u.x) * i) / steps, y = u.y + ((ty - u.y) * i) / steps;
    if (!w.nav.open(w.nav.node(u.layer, Math.floor(x), Math.floor(y)), u.team)) return false;
  }
  return true;
}

// ---------------------------------------------------------------- Ziele an Gebäuden
/** Rund um den Grundriss (Nachbar-Tiles am Boden). */
export function goalAround(b: SBuilding, breach = false): TravelGoal {
  const [fw, fh] = footprint(b.key, b.o);
  return { layer: 0, x0: b.x, y0: b.y, x1: b.x + fw - 1, y1: b.y + fh - 1, d: 1, breach };
}

/** Vor die Tür; wenn der Eingang zugebaut ist, irgendwo an den Grundriss. */
export function goalEntrance(w: World, b: SBuilding): TravelGoal {
  const [ex, ey] = entrance(b.key, b.x, b.y, b.o);
  if (w.inMap(ex, ey) && w.nav.open(w.nav.node(0, ex, ey), 0)) return tileGoal(ex, ey);
  return goalAround(b);
}

/**
 * Zu einem Fach im Lagerhaus: nur über die Zugangskachel vor dem Tor (kein Ausweichen an andere Seiten).
 * Hinein und zum Fach geht es danach mit storeVisit (jobs.ts). k bleibt für Aufrufer, die je Fach planen.
 */
export function goalSlot(_w: World, b: SBuilding, _k: number): TravelGoal {
  const [x, y] = entrance(b.key, b.x, b.y, b.o);
  return tileGoal(x, y);
}

export function isWorkshop(b: SBuilding): boolean { return !!BUILDINGS[b.key].workers; }
